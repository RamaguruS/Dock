/**
 * Waitlist auto-assignment: when capacity is released on a dock slot, the oldest compatible
 * WAITING entries for that exact slot are converted into bookings (FIFO), atomically.
 */
import { Booking } from '../models/Booking.js';
import { Dock, isDockCompatible } from '../models/Dock.js';
import { Warehouse } from '../models/Warehouse.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { hasApprovedAccess } from '../models/VendorAccess.js';
import { reserveCapacity, SlotFullError } from './scheduling.js';
import { notifyUser, notifyWarehouseAdmins, formatSlot } from './notifications.js';
import { audit } from './audit.js';
import { logger } from '../config/logger.js';

export async function processWaitlistForSlot(params: {
  warehouseId: string;
  dockId: string;
  startTime: Date;
  endTime: Date;
}): Promise<number> {
  const { warehouseId, dockId, startTime, endTime } = params;
  if (startTime <= new Date()) return 0;

  try {
    const [dock, warehouse] = await Promise.all([
      Dock.findOne({ _id: dockId, warehouseId, isActive: true }),
      Warehouse.findById(warehouseId),
    ]);
    if (!dock || !warehouse) return 0;

    const entries = await WaitlistEntry.find({
      warehouseId,
      status: 'WAITING',
      startTime,
      endTime,
      $or: [{ dockId }, { dockId: { $exists: false } }, { dockId: null }],
    }).sort({ createdAt: 1 });

    let assigned = 0;
    for (const entry of entries) {
      if (!isDockCompatible(dock, entry)) continue;
      if (!(await hasApprovedAccess(entry.vendorId.toString(), warehouseId))) continue;

      try {
        const booking = await reserveCapacity(
          { dockId, startTime, endTime, capacity: dock.maxCapacityPerHour },
          async (session) => {
            const [created] = await Booking.create(
              [
                {
                  warehouseId,
                  dockId,
                  vendorId: entry.vendorId,
                  truckNumber: entry.truckNumber,
                  driverName: entry.driverName,
                  driverPhone: entry.driverPhone,
                  startTime,
                  endTime,
                  direction: entry.direction,
                  trailerType: entry.trailerType,
                  hazmat: entry.hazmat,
                  referenceNumber: entry.referenceNumber,
                  palletCount: entry.palletCount,
                  status: 'PENDING',
                },
              ],
              { session }
            );
            // Claim the entry inside the same transaction so it can't be fulfilled twice
            const claimed = await WaitlistEntry.updateOne(
              { _id: entry._id, status: 'WAITING' },
              { $set: { status: 'FULFILLED', fulfilledBookingId: created._id } },
              { session }
            );
            if (claimed.modifiedCount === 0) throw new Error('WAITLIST_ALREADY_CLAIMED');
            return created;
          }
        );

        assigned++;
        const when = formatSlot(startTime, warehouse.timezone);
        await notifyUser(entry.vendorId, {
          type: 'WAITLIST_ASSIGNED',
          title: 'Waitlist slot assigned',
          message: `A slot opened up at ${warehouse.name} (${dock.dockName}, ${when}). Your truck ${entry.truckNumber} has been booked and is awaiting warehouse approval.`,
          bookingId: booking._id,
        });
        await notifyWarehouseAdmins(warehouseId, {
          type: 'BOOKING_CREATED',
          title: 'Waitlist auto-assignment',
          message: `Truck ${entry.truckNumber} was auto-assigned from the waitlist to ${dock.dockName} at ${when}. Approval needed.`,
          bookingId: booking._id,
        });
        await audit({
          system: true,
          warehouseId,
          action: 'WAITLIST_AUTO_ASSIGNED',
          entityType: 'BOOKING',
          entityId: booking._id,
          message: `Waitlist entry for truck ${entry.truckNumber} auto-assigned to ${dock.dockName} at ${when}`,
          metadata: { waitlistEntryId: entry._id.toString() },
        });
      } catch (error) {
        if (error instanceof SlotFullError) break; // no more capacity
        if ((error as Error).message === 'WAITLIST_ALREADY_CLAIMED') continue;
        throw error;
      }
    }
    return assigned;
  } catch (error) {
    logger.error(`[WAITLIST] Processing failed: ${(error as Error).message}`);
    return 0;
  }
}
