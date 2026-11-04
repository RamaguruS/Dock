import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Booking, BookingStatus, IBooking, BOOKING_STATUSES } from '../models/Booking.js';
import { TRAILER_TYPES, LoadRequirements } from '../models/Dock.js';
import { Warehouse, IWarehouse } from '../models/Warehouse.js';
import { User } from '../models/User.js';
import {
  computeDayAvailability,
  validateSlotRequest,
  reserveCapacity,
  SlotFullError,
  generateSlotGrid,
  localDateString,
  localTimeToUTC,
  addDaysToDateString,
} from '../services/scheduling.js';
import { processWaitlistForSlot } from '../services/waitlist.js';
import { notifyUser, notifyWarehouseAdmins, formatSlot } from '../services/notifications.js';
import { audit } from '../services/audit.js';

const objectIdString = (label: string) =>
  z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), `${label} must be a valid ID`);

const loadSchema = {
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('INBOUND'),
  trailerType: z.enum(TRAILER_TYPES).default('DRY_VAN'),
  hazmat: z.boolean().default(false),
};

const createBookingSchema = z.object({
  warehouseId: objectIdString('Warehouse ID'),
  dockId: objectIdString('Dock ID'),
  truckNumber: z.string().trim().min(1, 'Truck number is required').max(30),
  driverName: z.string().trim().min(1, 'Driver name is required').max(60),
  driverPhone: z.string().trim().min(5, 'Driver phone is required').max(20),
  startTime: z.string().datetime({ message: 'Start time must be a valid UTC ISO datetime string' }),
  endTime: z.string().datetime({ message: 'End time must be a valid UTC ISO datetime string' }),
  ...loadSchema,
  referenceNumber: z.string().trim().max(60).optional(),
  palletCount: z.number().int().min(0).max(100).optional(),
  cargoDescription: z.string().trim().max(200).optional(),
  recurrence: z.object({ weeks: z.number().int().min(1).max(12) }).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES),
  reason: z.string().trim().max(200).optional(),
});

const rescheduleSchema = z.object({
  dockId: objectIdString('Dock ID').optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

/**
 * Appointment lifecycle (yard flow):
 *   PENDING → APPROVED → CHECKED_IN (gate) → IN_PROGRESS (at door) → COMPLETED
 * COMPLETED / CANCELLED / REJECTED / NO_SHOW are terminal, so a released slot can never be
 * re-occupied by reviving an old booking (that would bypass the capacity check).
 */
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING:     ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED:    ['CHECKED_IN', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN:  ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED:   [],
  CANCELLED:   [],
  REJECTED:    [],
  NO_SHOW:     [],
};

/** Carriers may cancel / reschedule their own bookings, but only before the truck arrives. */
const VENDOR_MUTABLE: BookingStatus[] = ['PENDING', 'APPROVED'];

const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'pending approval',
  APPROVED: 'approved',
  CHECKED_IN: 'checked in at the gate',
  IN_PROGRESS: 'at the dock',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  NO_SHOW: 'marked as a no-show',
};

const parseLoadQuery = (q: Request['query']): LoadRequirements => ({
  direction: typeof q.direction === 'string' && q.direction ? q.direction : undefined,
  trailerType: typeof q.trailerType === 'string' && q.trailerType ? q.trailerType : undefined,
  hazmat: q.hazmat === 'true',
});

const isDateString = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const carrierName = async (vendorId: string) => {
  const v = await User.findById(vendorId).select('vendorCompany username');
  return v?.vendorCompany || v?.username || 'Carrier';
};

// ---------------------------------------------------------------------------
// Create (single or weekly recurring)
// ---------------------------------------------------------------------------

export const createBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }
    const data = parsed.data;
    const vendorId = req.user!.userId;

    const warehouse = await Warehouse.findById(data.warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const load: LoadRequirements = { direction: data.direction, trailerType: data.trailerType, hazmat: data.hazmat };
    const firstStart = new Date(data.startTime);
    const firstEnd = new Date(data.endTime);

    const first = await validateSlotRequest(data.warehouseId, warehouse, data.dockId, firstStart, firstEnd, load);
    if (!first.ok) {
      res.status(first.status).json({ error: first.error });
      return;
    }

    const weeks = data.recurrence?.weeks ?? 1;
    const recurrenceGroupId = weeks > 1 ? randomUUID() : undefined;
    const firstLocalDate = localDateString(firstStart, warehouse.timezone);
    const localStart = first.localTime.split(' - ')[0];

    const created: IBooking[] = [];
    const skipped: { date: string; reason: string }[] = [];

    for (let k = 0; k < weeks; k++) {
      const date = addDaysToDateString(firstLocalDate, 7 * k);
      let start = firstStart;
      let end = firstEnd;

      if (k > 0) {
        const grid = generateSlotGrid(warehouse, date);
        const slot = grid.slots.find((s) => s.startLocal === localStart);
        if (!slot) {
          skipped.push({ date, reason: grid.message ?? 'Slot not offered on this day' });
          continue;
        }
        start = slot.startUTC;
        end = slot.endUTC;
        const check = await validateSlotRequest(data.warehouseId, warehouse, data.dockId, start, end, load);
        if (!check.ok) {
          skipped.push({ date, reason: check.error });
          continue;
        }
      }

      try {
        const booking = await reserveCapacity(
          { dockId: data.dockId, startTime: start, endTime: end, capacity: first.dock.maxCapacityPerHour },
          async (session) => {
            const [b] = await Booking.create(
              [
                {
                  warehouseId: data.warehouseId,
                  dockId: data.dockId,
                  vendorId,
                  truckNumber: data.truckNumber,
                  driverName: data.driverName,
                  driverPhone: data.driverPhone,
                  startTime: start,
                  endTime: end,
                  direction: data.direction,
                  trailerType: data.trailerType,
                  hazmat: data.hazmat,
                  referenceNumber: data.referenceNumber,
                  palletCount: data.palletCount,
                  cargoDescription: data.cargoDescription,
                  recurrenceGroupId,
                  status: 'PENDING',
                },
              ],
              { session }
            );
            return b;
          }
        );
        created.push(booking);
      } catch (error) {
        if (error instanceof SlotFullError) {
          skipped.push({ date, reason: 'Slot is fully booked' });
          continue;
        }
        throw error;
      }
    }

    if (created.length === 0) {
      res.status(409).json({
        error: 'Double Booking Conflict: This dock slot is already fully booked.',
        skipped,
      });
      return;
    }

    const name = await carrierName(vendorId);
    const when = formatSlot(created[0].startTime, warehouse.timezone);
    const seriesText = weeks > 1 ? ` (weekly series: ${created.length} of ${weeks} appointments booked)` : '';

    await audit({
      req,
      warehouseId: data.warehouseId,
      action: weeks > 1 ? 'RECURRING_BOOKING_CREATED' : 'BOOKING_CREATED',
      entityType: 'BOOKING',
      entityId: created[0]._id,
      message: `${name} requested ${first.dock.dockName} at ${when} for truck ${data.truckNumber}${seriesText}`,
      metadata: { bookingIds: created.map((b) => b._id.toString()), skipped, recurrenceGroupId },
    });
    await notifyWarehouseAdmins(data.warehouseId, {
      type: 'BOOKING_CREATED',
      title: 'New appointment request',
      message: `${name}: truck ${data.truckNumber} (${data.direction.toLowerCase()}, ${data.trailerType.replace('_', ' ').toLowerCase()}) at ${first.dock.dockName}, ${when}${seriesText}.`,
      bookingId: created[0]._id,
    });
    await notifyUser(vendorId, {
      type: 'BOOKING_CREATED',
      title: 'Appointment requested',
      message: `Your appointment at ${warehouse.name} (${first.dock.dockName}, ${when}) is awaiting approval${seriesText}.`,
      bookingId: created[0]._id,
    });

    res.status(201).json({
      message: weeks > 1 ? `${created.length} of ${weeks} weekly appointments booked` : 'Booking created successfully',
      booking: created[0],
      bookings: created,
      skipped,
      recurrenceGroupId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const getBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: Record<string, any> = {};

    // Enforce Tenant Isolation
    if (req.user?.role === 'VENDOR') {
      filter.vendorId = req.user.userId;
    } else if (req.user?.role === 'WAREHOUSE_ADMIN') {
      filter.warehouseId = req.user.warehouseId;
    }

    const fromQuery = req.query.from as string;
    const toQuery = req.query.to as string;
    if (fromQuery && toQuery) {
      const from = new Date(fromQuery);
      const to = new Date(toQuery);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        res.status(400).json({ error: 'from and to must be valid ISO dates' });
        return;
      }
      filter.startTime = { $gte: from, $lte: to };
    }

    if (typeof req.query.status === 'string' && req.query.status) {
      filter.status = { $in: req.query.status.split(',') };
    }
    if (typeof req.query.recurrenceGroupId === 'string') {
      filter.recurrenceGroupId = req.query.recurrenceGroupId;
    }

    const bookings = await Booking.find(filter)
      .populate('dockId', 'dockName direction supportedTrailerTypes hazmatCertified maxCapacityPerHour')
      .populate('vendorId', 'username email vendorCompany')
      .populate('warehouseId', 'name address timezone')
      .sort({ startTime: 1 })
      .limit(2000);

    res.status(200).json({ bookings });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Status changes (approve / reject / gate check-in / dock start / complete / no-show / cancel)
// ---------------------------------------------------------------------------

type AuthorizedBooking = { booking: IBooking; warehouse: IWarehouse } | { status: number; error: string };

async function loadAuthorizedBooking(req: Request, id: string): Promise<AuthorizedBooking> {
  if (!mongoose.Types.ObjectId.isValid(id)) return { status: 400, error: 'Invalid booking ID' };
  const booking = await Booking.findById(id);
  if (!booking) return { status: 404, error: 'Booking not found' };

  const role = req.user?.role;
  if (role === 'WAREHOUSE_ADMIN' && booking.warehouseId.toString() !== req.user?.warehouseId) {
    return { status: 403, error: 'Forbidden: You do not manage the warehouse for this booking' };
  }
  if (role === 'VENDOR' && booking.vendorId.toString() !== req.user?.userId) {
    return { status: 403, error: 'Forbidden: You do not own this booking' };
  }
  if (!role || !['WAREHOUSE_ADMIN', 'VENDOR', 'SUPER_ADMIN'].includes(role)) {
    return { status: 403, error: 'Forbidden: Insufficient privileges' };
  }

  const warehouse = await Warehouse.findById(booking.warehouseId);
  if (!warehouse) return { status: 404, error: 'Warehouse not found' };
  return { booking, warehouse };
}

export const updateBookingStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }
    const { status, reason } = parsed.data;

    const loaded = await loadAuthorizedBooking(req, req.params.id);
    if ('error' in loaded) {
      res.status(loaded.status).json({ error: loaded.error });
      return;
    }
    const { booking, warehouse } = loaded;
    const isVendor = req.user?.role === 'VENDOR';

    if (isVendor) {
      if (status !== 'CANCELLED') {
        res.status(400).json({ error: 'Vendors are only allowed to cancel bookings' });
        return;
      }
      if (!VENDOR_MUTABLE.includes(booking.status)) {
        res.status(400).json({ error: `Cannot cancel a booking in status: ${booking.status}` });
        return;
      }
    }

    // Lifecycle enforcement (applies to every role)
    if (!ALLOWED_TRANSITIONS[booking.status].includes(status)) {
      res.status(400).json({ error: `Invalid status change: ${booking.status} -> ${status}` });
      return;
    }

    const now = new Date();
    const set: Record<string, unknown> = { status };

    if (status === 'NO_SHOW' && now < booking.startTime) {
      res.status(400).json({ error: 'A booking can only be marked as a no-show after its slot has started' });
      return;
    }
    if (status === 'CHECKED_IN' || (status === 'IN_PROGRESS' && !booking.checkedInAt)) {
      const lateBy = Math.round((now.getTime() - booking.startTime.getTime()) / 60000);
      set.checkedInAt = now;
      set.lateByMinutes = Math.max(0, lateBy);
      set.arrivalStatus = lateBy > (warehouse.lateThresholdMinutes ?? 15) ? 'LATE' : 'ON_TIME';
    }
    if (status === 'IN_PROGRESS') set.dockStartedAt = now;
    if (status === 'COMPLETED') set.completedAt = now;
    if ((status === 'CANCELLED' || status === 'REJECTED') && reason) set.cancelReason = reason;

    // Conditional update: fails if someone else changed the status in the meantime
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: booking.status },
      { $set: set },
      { new: true, runValidators: true }
    );
    if (!updated) {
      res.status(409).json({ error: 'Booking status was changed by someone else. Refresh and try again.' });
      return;
    }

    const when = formatSlot(updated.startTime, warehouse.timezone);
    const name = await carrierName(updated.vendorId.toString());
    const arrivalNote =
      set.arrivalStatus === 'LATE' ? ` (late by ${set.lateByMinutes} min)` : set.arrivalStatus ? ' (on time)' : '';

    await audit({
      req,
      warehouseId: updated.warehouseId,
      action: 'BOOKING_STATUS_CHANGED',
      entityType: 'BOOKING',
      entityId: updated._id,
      message: `${name} / truck ${updated.truckNumber} at ${when}: ${booking.status} → ${status}${arrivalNote}${reason ? ` — ${reason}` : ''}`,
      metadata: { from: booking.status, to: status, reason },
    });

    if (isVendor) {
      await notifyWarehouseAdmins(updated.warehouseId, {
        type: 'BOOKING_CANCELLED',
        title: 'Appointment cancelled by carrier',
        message: `${name} cancelled truck ${updated.truckNumber} at ${when}.${reason ? ` Reason: ${reason}` : ''}`,
        bookingId: updated._id,
      });
    } else if (['APPROVED', 'REJECTED', 'CANCELLED', 'NO_SHOW'].includes(status)) {
      await notifyUser(updated.vendorId, {
        type: `BOOKING_${status}`,
        title: `Appointment ${STATUS_LABEL[status]}`,
        message: `Truck ${updated.truckNumber} at ${warehouse.name}, ${when} was ${STATUS_LABEL[status]}.${reason ? ` Reason: ${reason}` : ''}`,
        bookingId: updated._id,
        smsTo: status === 'APPROVED' ? updated.driverPhone : undefined,
      });
    }

    // Freed capacity → give it to the waitlist
    if (status === 'CANCELLED' || status === 'REJECTED') {
      await processWaitlistForSlot({
        warehouseId: updated.warehouseId.toString(),
        dockId: updated.dockId.toString(),
        startTime: updated.startTime,
        endTime: updated.endTime,
      });
    }

    res.status(200).json({
      message: `Booking status updated to ${status}`,
      booking: updated,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Reschedule (move to another slot and/or dock without losing the booking)
// ---------------------------------------------------------------------------

export const rescheduleBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = rescheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const loaded = await loadAuthorizedBooking(req, req.params.id);
    if ('error' in loaded) {
      res.status(loaded.status).json({ error: loaded.error });
      return;
    }
    const { booking, warehouse } = loaded;

    if (!VENDOR_MUTABLE.includes(booking.status)) {
      res.status(400).json({ error: `Only pending or approved appointments can be rescheduled (current: ${booking.status})` });
      return;
    }

    const newDockId = parsed.data.dockId ?? booking.dockId.toString();
    const startTime = new Date(parsed.data.startTime);
    const endTime = new Date(parsed.data.endTime);

    if (
      newDockId === booking.dockId.toString() &&
      startTime.getTime() === booking.startTime.getTime() &&
      endTime.getTime() === booking.endTime.getTime()
    ) {
      res.status(400).json({ error: 'The new slot is the same as the current one' });
      return;
    }

    const check = await validateSlotRequest(booking.warehouseId.toString(), warehouse, newDockId, startTime, endTime, {
      direction: booking.direction,
      trailerType: booking.trailerType,
      hazmat: booking.hazmat,
    });
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }

    const old = { dockId: booking.dockId, startTime: booking.startTime, endTime: booking.endTime };
    const isVendor = req.user?.role === 'VENDOR';
    // A carrier moving a confirmed appointment needs re-approval; an admin move keeps the status.
    const newStatus: BookingStatus = isVendor ? 'PENDING' : booking.status;

    let updated: IBooking | null;
    try {
      updated = await reserveCapacity(
        {
          dockId: newDockId,
          startTime,
          endTime,
          capacity: check.dock.maxCapacityPerHour,
          excludeBookingId: booking._id.toString(),
        },
        (session) =>
          Booking.findOneAndUpdate(
            { _id: booking._id, status: booking.status },
            {
              $set: { dockId: newDockId, startTime, endTime, status: newStatus },
              $unset: { reminderSentAt: 1 },
              $push: {
                rescheduleHistory: {
                  fromStart: old.startTime,
                  fromEnd: old.endTime,
                  fromDockId: old.dockId,
                  toStart: startTime,
                  toEnd: endTime,
                  toDockId: newDockId,
                  by: req.user?.userId,
                  at: new Date(),
                },
              },
            },
            { new: true, runValidators: true, session }
          )
      );
    } catch (error) {
      if (error instanceof SlotFullError) {
        res.status(409).json({ error: 'The new slot is already fully booked.' });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(409).json({ error: 'Booking was changed by someone else. Refresh and try again.' });
      return;
    }

    const fromWhen = formatSlot(old.startTime, warehouse.timezone);
    const toWhen = formatSlot(startTime, warehouse.timezone);
    const name = await carrierName(updated.vendorId.toString());

    await audit({
      req,
      warehouseId: updated.warehouseId,
      action: 'BOOKING_RESCHEDULED',
      entityType: 'BOOKING',
      entityId: updated._id,
      message: `${name} / truck ${updated.truckNumber} moved from ${fromWhen} to ${toWhen} (${check.dock.dockName})`,
      metadata: { fromDockId: old.dockId.toString(), toDockId: newDockId, fromStart: old.startTime, toStart: startTime },
    });

    if (isVendor) {
      await notifyWarehouseAdmins(updated.warehouseId, {
        type: 'BOOKING_RESCHEDULED',
        title: 'Appointment rescheduled by carrier',
        message: `${name} moved truck ${updated.truckNumber} from ${fromWhen} to ${toWhen} (${check.dock.dockName}). Re-approval needed.`,
        bookingId: updated._id,
      });
    } else {
      await notifyUser(updated.vendorId, {
        type: 'BOOKING_RESCHEDULED',
        title: 'Appointment rescheduled by warehouse',
        message: `${warehouse.name} moved truck ${updated.truckNumber} from ${fromWhen} to ${toWhen} (${check.dock.dockName}).`,
        bookingId: updated._id,
        smsTo: updated.driverPhone,
      });
    }

    // The old slot has a free place now
    await processWaitlistForSlot({
      warehouseId: updated.warehouseId.toString(),
      dockId: old.dockId.toString(),
      startTime: old.startTime,
      endTime: old.endTime,
    });

    res.status(200).json({ message: 'Appointment rescheduled', booking: updated });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Cancel the remaining appointments of a recurring series
// ---------------------------------------------------------------------------

export const cancelSeries = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId } = req.params;
    const filter: Record<string, unknown> = {
      recurrenceGroupId: groupId,
      status: { $in: VENDOR_MUTABLE },
      startTime: { $gt: new Date() },
    };
    if (req.user?.role === 'VENDOR') filter.vendorId = req.user.userId;
    else if (req.user?.role === 'WAREHOUSE_ADMIN') filter.warehouseId = req.user.warehouseId;

    const bookings = await Booking.find(filter);
    let cancelled = 0;
    for (const b of bookings) {
      const r = await Booking.updateOne(
        { _id: b._id, status: b.status },
        { $set: { status: 'CANCELLED', cancelReason: 'Recurring series cancelled' } }
      );
      if (r.modifiedCount) {
        cancelled++;
        await processWaitlistForSlot({
          warehouseId: b.warehouseId.toString(),
          dockId: b.dockId.toString(),
          startTime: b.startTime,
          endTime: b.endTime,
        });
      }
    }

    if (bookings[0]) {
      const name = await carrierName(bookings[0].vendorId.toString());
      await audit({
        req,
        warehouseId: bookings[0].warehouseId,
        action: 'RECURRING_SERIES_CANCELLED',
        entityType: 'BOOKING',
        entityId: groupId,
        message: `${name}: ${cancelled} upcoming appointments of a weekly series (truck ${bookings[0].truckNumber}) cancelled`,
      });
      if (req.user?.role === 'VENDOR') {
        await notifyWarehouseAdmins(bookings[0].warehouseId, {
          type: 'BOOKING_CANCELLED',
          title: 'Recurring series cancelled',
          message: `${name} cancelled ${cancelled} upcoming weekly appointments for truck ${bookings[0].truckNumber}.`,
        });
      }
    }

    res.status(200).json({ message: `${cancelled} upcoming appointments cancelled`, cancelled });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export const getAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const { warehouseId, date, dockId } = req.query as { warehouseId: string; date: string; dockId?: string };

    if (!isDateString(date)) {
      res.status(400).json({ error: 'warehouseId and date (YYYY-MM-DD) are required' });
      return;
    }
    if (dockId && !mongoose.Types.ObjectId.isValid(dockId)) {
      res.status(400).json({ error: 'Invalid dockId' });
      return;
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const result = await computeDayAvailability(warehouseId, date, warehouse, {
      filterDockId: dockId,
      load: parseLoadQuery(req.query),
    });
    res.status(200).json({ ...result, timezone: warehouse.timezone });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getAvailabilitySummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { warehouseId, dockId, startDate, days: daysParam } = req.query as {
      warehouseId: string;
      dockId?: string;
      startDate: string;
      days?: string;
    };

    if (!isDateString(startDate)) {
      res.status(400).json({ error: 'warehouseId and startDate (YYYY-MM-DD) are required' });
      return;
    }

    const requestedDays = Math.min(parseInt(daysParam ?? '7', 10) || 7, 14);

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const dayAbbrevs = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayFullNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const load = parseLoadQuery(req.query);

    const summary = await Promise.all(
      Array.from({ length: requestedDays }, async (_, i) => {
        const dateStr = addDaysToDateString(startDate, i);
        const [y, m, d] = dateStr.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const dayResult = await computeDayAvailability(warehouseId, dateStr, warehouse, {
          filterDockId: dockId && mongoose.Types.ObjectId.isValid(dockId) ? dockId : undefined,
          load,
        });

        let totalSlots = 0;
        let freeSlots = 0;
        for (const dock of dayResult.docks) {
          const future = dock.slots.filter((s) => s.reason !== 'PAST');
          totalSlots += future.length;
          freeSlots += future.filter((s) => s.available).length;
        }

        return {
          date: dateStr,
          dayOfWeek: dayFullNames[dow],
          dayAbbrev: dayAbbrevs[dow],
          isOpen: !dayResult.closed,
          closedReason: dayResult.closed ? dayResult.message : undefined,
          totalSlots,
          freeSlots,
          fullyBooked: !dayResult.closed && totalSlots > 0 && freeSlots === 0,
        };
      })
    );

    res.status(200).json({ summary });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getCalendarSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    // warehouseId ALWAYS from JWT — never trust query string
    const warehouseId = req.user?.warehouseId;
    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse associated with your account' });
      return;
    }

    const monthParam = req.query.month as string; // format: "2026-07"
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      res.status(400).json({ error: 'month query param is required in YYYY-MM format' });
      return;
    }

    const warehouse = await Warehouse.findById(warehouseId).select('timezone');
    const timezone = warehouse?.timezone ?? 'UTC';

    const [year, month] = monthParam.split('-').map(Number);
    const firstDay = `${monthParam}-01`;
    const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    // Month boundaries in the warehouse's local time
    const startOfMonth = localTimeToUTC(firstDay, '00:00', timezone);
    const startOfNextMonth = localTimeToUTC(nextMonth, '00:00', timezone);

    const summary = await Booking.aggregate([
      {
        $match: {
          warehouseId: new mongoose.Types.ObjectId(warehouseId),
          startTime: { $gte: startOfMonth, $lt: startOfNextMonth },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone } },
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $in: ['$status', ['CHECKED_IN', 'IN_PROGRESS']] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
          noShow: { $sum: { $cond: [{ $eq: ['$status', 'NO_SHOW'] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          total: 1,
          pending: 1,
          approved: 1,
          inProgress: 1,
          completed: 1,
          cancelled: 1,
          rejected: 1,
          noShow: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);
    res.status(200).json({ summary });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
