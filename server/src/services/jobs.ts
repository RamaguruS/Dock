/**
 * Background automation (runs every minute in each server process; all updates are conditional,
 * so running on several instances at once is safe):
 *   - NO_SHOW: approved appointments not checked in within the warehouse's grace period
 *   - Expire PENDING requests whose slot has started without approval
 *   - Reminders ~24 h before approved appointments (carrier email + driver SMS when configured)
 *   - Expire waitlist entries whose slot has passed
 */
import { Booking } from '../models/Booking.js';
import { Warehouse } from '../models/Warehouse.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { notifyUser, formatSlot } from './notifications.js';
import { audit } from './audit.js';
import { logger } from '../config/logger.js';

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

async function markNoShows(now: Date) {
  const warehouses = await Warehouse.find().select('name timezone noShowGraceMinutes');
  for (const w of warehouses) {
    const cutoff = new Date(now.getTime() - (w.noShowGraceMinutes ?? 60) * 60000);
    const due = await Booking.find({ warehouseId: w._id, status: 'APPROVED', startTime: { $lt: cutoff } }).limit(200);
    for (const b of due) {
      const updated = await Booking.findOneAndUpdate(
        { _id: b._id, status: 'APPROVED' },
        { $set: { status: 'NO_SHOW' } },
        { new: true }
      );
      if (!updated) continue;
      const when = formatSlot(b.startTime, w.timezone);
      await audit({
        system: true,
        warehouseId: w._id,
        action: 'BOOKING_NO_SHOW',
        entityType: 'BOOKING',
        entityId: b._id,
        message: `Truck ${b.truckNumber} did not arrive for ${when}; marked NO_SHOW after ${w.noShowGraceMinutes} min grace`,
      });
      await notifyUser(b.vendorId, {
        type: 'BOOKING_NO_SHOW',
        title: 'Missed appointment (no-show)',
        message: `Truck ${b.truckNumber} did not check in for ${w.name}, ${when}. This affects your reliability score.`,
        bookingId: b._id,
      });
    }
  }
}

async function expirePendingRequests(now: Date) {
  const stale = await Booking.find({ status: 'PENDING', startTime: { $lt: now } }).limit(200);
  for (const b of stale) {
    const updated = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'PENDING' },
      { $set: { status: 'CANCELLED', cancelReason: 'Expired: not approved before the appointment time' } },
      { new: true }
    );
    if (!updated) continue;
    await audit({
      system: true,
      warehouseId: b.warehouseId,
      action: 'BOOKING_EXPIRED',
      entityType: 'BOOKING',
      entityId: b._id,
      message: `Request for truck ${b.truckNumber} expired without approval`,
    });
    await notifyUser(b.vendorId, {
      type: 'BOOKING_EXPIRED',
      title: 'Appointment request expired',
      message: `Your request for truck ${b.truckNumber} was not approved before its slot time and has been closed.`,
      bookingId: b._id,
    });
  }
}

async function sendReminders(now: Date) {
  const upcoming = await Booking.find({
    status: 'APPROVED',
    reminderSentAt: { $exists: false },
    startTime: { $gt: now, $lte: new Date(now.getTime() + REMINDER_LEAD_MS) },
  })
    .populate('warehouseId', 'name timezone address')
    .populate('dockId', 'dockName')
    .limit(200);

  for (const b of upcoming) {
    // Claim first so only one instance sends it
    const claimed = await Booking.updateOne(
      { _id: b._id, reminderSentAt: { $exists: false } },
      { $set: { reminderSentAt: now } }
    );
    if (claimed.modifiedCount === 0) continue;
    const w = b.warehouseId as any;
    const dock = b.dockId as any;
    await notifyUser(b.vendorId, {
      type: 'REMINDER',
      title: 'Upcoming appointment reminder',
      message: `Truck ${b.truckNumber} is due at ${w?.name} (${w?.address}), ${dock?.dockName}, ${formatSlot(b.startTime, w?.timezone ?? 'UTC')}. Please arrive on time and check in at the gate.`,
      bookingId: b._id,
      smsTo: b.driverPhone,
    });
  }
}

async function expireWaitlist(now: Date) {
  await WaitlistEntry.updateMany({ status: 'WAITING', startTime: { $lte: now } }, { $set: { status: 'EXPIRED' } });
}

let running = false;

export async function runJobsOnce(): Promise<void> {
  if (running) return;
  running = true;
  const now = new Date();
  try {
    await markNoShows(now);
    await expirePendingRequests(now);
    await sendReminders(now);
    await expireWaitlist(now);
  } catch (error) {
    logger.error(`[JOBS] ${(error as Error).message}`);
  } finally {
    running = false;
  }
}

export function startJobs(intervalMs = 60_000): NodeJS.Timeout {
  void runJobsOnce();
  return setInterval(() => void runJobsOnce(), intervalMs);
}
