import { Request, Response } from 'express';
import { logger } from '../config/logger.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Booking, BookingStatus } from '../models/Booking.js';
import { Dock } from '../models/Dock.js';
import { Warehouse } from '../models/Warehouse.js';

const createBookingSchema = z.object({
  warehouseId: z.string().min(1, 'Warehouse ID is required'),
  dockId: z.string().min(1, 'Dock ID is required'),
  truckNumber: z.string().min(1, 'Truck number is required'),
  driverName: z.string().min(1, 'Driver name is required'),
  driverPhone: z.string().min(1, 'Driver phone is required'),
  startTime: z.string().datetime({ message: 'Start time must be a valid UTC ISO datetime string' }),
  endTime: z.string().datetime({ message: 'End time must be a valid UTC ISO datetime string' }),
});

const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED']),
});

export const createBooking = async (req: Request, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  try {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { warehouseId, dockId, truckNumber, driverName, driverPhone, startTime: startStr, endTime: endStr } = parsed.data;

    const startTime = new Date(startStr);
    const endTime = new Date(endStr);

    if (startTime >= endTime) {
      res.status(400).json({ error: 'Start time must be before end time' });
      return;
    }

    if (startTime <= new Date()) {
      res.status(400).json({ error: 'Start time must be in the future' });
      return;
    }

    // 1. Verify Dock exists, is active, and belongs to the specified warehouse
    const dock = await Dock.findOne({ _id: dockId, warehouseId, isActive: true });
    if (!dock) {
      res.status(400).json({ error: 'Selected dock is inactive or does not belong to this warehouse' });
      return;
    }

    const vendorId = req.user?.userId;
    if (!vendorId) {
      res.status(401).json({ error: 'Unauthorized: Vendor identifier missing' });
      return;
    }

    // 2. Atomic overlap check and insertion using a Transaction (falls back to check-and-save on non-replica set standalone databases)
    let newBooking: any = null;
    try {
      await session.withTransaction(async () => {
        const conflictingBooking = await Booking.findOne({
          dockId,
          status: { $nin: ['CANCELLED', 'REJECTED'] },
          $or: [
            { startTime: { $lt: endTime }, endTime: { $gt: startTime } },
          ],
        }).session(session);

        if (conflictingBooking) {
          throw new Error('CONFL_BOOKING: Selected dock is already booked during this timeslot');
        }

        newBooking = new Booking({
          warehouseId,
          dockId,
          vendorId,
          truckNumber,
          driverName,
          driverPhone,
          startTime,
          endTime,
          status: 'PENDING',
        });

        await newBooking.save({ session });
      });
    } catch (error: any) {
      if (error.message === 'CONFL_BOOKING: Selected dock is already booked during this timeslot') {
        res.status(409).json({ error: 'Double Booking Conflict: This dock is already booked during this timeslot.' });
        return;
      }

      // Check if it's a transaction support error (replica set required)
      const isReplicaSetError = 
        error.message?.includes('replica set') || 
        error.message?.includes('Transaction numbers') || 
        error.code === 20 || 
        error.codeName === 'TransactionSystemFailed';

      if (isReplicaSetError) {
        // Fallback E2E execution without transaction
        const conflictingBooking = await Booking.findOne({
          dockId,
          status: { $nin: ['CANCELLED', 'REJECTED'] },
          $or: [
            { startTime: { $lt: endTime }, endTime: { $gt: startTime } },
          ],
        });

        if (conflictingBooking) {
          res.status(409).json({ error: 'Double Booking Conflict: This dock is already booked during this timeslot.' });
          return;
        }

        newBooking = new Booking({
          warehouseId,
          dockId,
          vendorId,
          truckNumber,
          driverName,
          driverPhone,
          startTime,
          endTime,
          status: 'PENDING',
        });

        await newBooking.save();
      } else {
        throw error;
      }
    }

    logger.info(`[AUDIT] Booking created: ID ${newBooking._id}, Vendor: ${vendorId}, Dock: ${dockId}, Range: ${startTime.toISOString()} to ${endTime.toISOString()}`);

    res.status(201).json({
      message: 'Booking created successfully',
      booking: newBooking,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

export const getBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: any = {};

    // Enforce Tenant Isolation
    if (req.user?.role === 'VENDOR') {
      filter.vendorId = req.user.userId;
    } else if (req.user?.role === 'WAREHOUSE_ADMIN') {
      filter.warehouseId = req.user.warehouseId;
    }

    // Filter by explicit UTC from/to range (preferred for calendar-driven queries)
    const fromQuery = req.query.from as string;
    const toQuery   = req.query.to   as string;

    if (fromQuery && toQuery) {
      filter.startTime = { $gte: new Date(fromQuery), $lte: new Date(toQuery) };
    } else {
      // Legacy: filter by a local YYYY-MM-DD date string
      const dateQuery = req.query.date as string;
      if (dateQuery) {
        const startOfDay = new Date(dateQuery);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(dateQuery);
        endOfDay.setUTCHours(23, 59, 59, 999);
        filter.startTime = { $gte: startOfDay, $lte: endOfDay };
      }
    }

    const bookings = await Booking.find(filter)
      .populate('dockId')
      .populate('vendorId', 'username email vendorCompany')
      .populate('warehouseId', 'name address timezone')
      .sort({ startTime: 1 });

    res.status(200).json({ bookings });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};


export const updateBookingStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { status } = parsed.data;

    const booking = await Booking.findById(id);
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    // Tenant Isolation & RBAC enforcement
    if (req.user?.role === 'WAREHOUSE_ADMIN') {
      // Warehouse Admin can update bookings only in their warehouse
      if (booking.warehouseId.toString() !== req.user.warehouseId) {
        res.status(403).json({ error: 'Forbidden: You do not manage the warehouse for this booking' });
        return;
      }
    } else if (req.user?.role === 'VENDOR') {
      // Vendors can only CANCEL their own bookings
      if (booking.vendorId.toString() !== req.user.userId) {
        res.status(403).json({ error: 'Forbidden: You do not own this booking' });
        return;
      }

      if (status !== 'CANCELLED') {
        res.status(400).json({ error: 'Vendors are only allowed to cancel bookings' });
        return;
      }

      if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED' || booking.status === 'REJECTED') {
        res.status(400).json({ error: `Cannot cancel a booking in status: ${booking.status}` });
        return;
      }
    } else if (req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
      return;
    }

    booking.status = status;
    await booking.save();

    logger.info(`[AUDIT] Booking status updated: ID ${booking._id}, Status: ${status}, Updated by: ${req.user?.userId} (${req.user?.role})`);

    res.status(200).json({
      message: `Booking status updated to ${status}`,
      booking,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Shared helpers — availability computation
// ---------------------------------------------------------------------------

/** Convert a local HH:mm string in the given IANA timezone to an exact UTC Date. */
function getUTCStartAndEnd(dateStr: string, timeStr: string, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  let utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(utcDate);
    const partMap: Record<string, string> = {};
    parts.forEach((p) => { partMap[p.type] = p.value; });

    const fYear = parseInt(partMap.year);
    const fMonth = parseInt(partMap.month);
    const fDay = parseInt(partMap.day);
    let fHour = parseInt(partMap.hour);
    if (fHour === 24) fHour = 0;
    const fMinute = parseInt(partMap.minute);

    const diffMs =
      Date.UTC(year, month - 1, day, hour, minute) -
      Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute);

    if (diffMs === 0) break;
    utcDate = new Date(utcDate.getTime() + diffMs);
  }
  return utcDate;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

interface DockSlotDetail {
  startTime: string;        // ISO UTC
  endTime: string;          // ISO UTC
  localTime: string;        // "09:00 - 10:00"
  available: boolean;
  remainingCapacity: number;
  maxCapacity: number;
}

interface DockAvailabilityDetail {
  dockId: string;
  dockName: string;
  maxCapacityPerHour: number;
  slots: DockSlotDetail[];
}

interface DayAvailabilityResult {
  closed: boolean;
  message?: string;
  docks: DockAvailabilityDetail[];
}

/**
 * Core availability computation for a single date string (YYYY-MM-DD).
 * Shared by getAvailability (full detail) and getAvailabilitySummary (tallies only).
 * Optionally filter to a specific dockId.
 */
async function computeDayAvailability(
  warehouseId: string,
  date: string,
  warehouse: { timezone: string; operatingHours: any[] },
  filterDockId?: string
): Promise<DayAvailabilityResult> {
  const [year, month, day] = date.split('-').map(Number);
  const parsedDate = new Date(year, month - 1, day);
  const dayOfWeek = DAY_NAMES[parsedDate.getDay()];

  const opHours = warehouse.operatingHours.find((oh: any) => oh.day === dayOfWeek);
  if (!opHours || !opHours.isOpen) {
    return { closed: true, message: 'Warehouse is closed on this day', docks: [] };
  }

  const dockQuery: any = { warehouseId, isActive: true };
  if (filterDockId) dockQuery._id = filterDockId;

  const docks = await Dock.find(dockQuery);
  if (docks.length === 0) {
    return { closed: false, message: 'No active docks in this warehouse', docks: [] };
  }

  const startOfDayUTC = getUTCStartAndEnd(date, opHours.start, warehouse.timezone);
  const endOfDayUTC   = getUTCStartAndEnd(date, opHours.end,   warehouse.timezone);

  const bookings = await Booking.find({
    warehouseId,
    status: { $nin: ['CANCELLED', 'REJECTED'] },
    startTime: { $lt: endOfDayUTC },
    endTime:   { $gt: startOfDayUTC },
  });

  // Generate hourly slots
  const [startHour] = opHours.start.split(':').map(Number);
  const [endHour]   = opHours.end.split(':').map(Number);
  const pad = (n: number) => n.toString().padStart(2, '0');

  const slotsList: { startLocal: string; endLocal: string; startUTC: Date; endUTC: Date }[] = [];
  for (let h = startHour; h < endHour; h++) {
    const startStr = `${pad(h)}:00`;
    const endStr   = `${pad(h + 1)}:00`;
    slotsList.push({
      startLocal: startStr,
      endLocal:   endStr,
      startUTC:   getUTCStartAndEnd(date, startStr, warehouse.timezone),
      endUTC:     getUTCStartAndEnd(date, endStr,   warehouse.timezone),
    });
  }

  const resultDocks: DockAvailabilityDetail[] = docks.map((dock) => {
    const dockSlots: DockSlotDetail[] = slotsList.map((slot) => {
      const overlapping = bookings.filter(
        (b) =>
          b.dockId.toString() === dock._id.toString() &&
          b.startTime < slot.endUTC &&
          b.endTime   > slot.startUTC
      );
      const remaining = Math.max(0, dock.maxCapacityPerHour - overlapping.length);
      return {
        startTime:         slot.startUTC.toISOString(),
        endTime:           slot.endUTC.toISOString(),
        localTime:         `${slot.startLocal} - ${slot.endLocal}`,
        available:         remaining > 0,
        remainingCapacity: remaining,
        maxCapacity:       dock.maxCapacityPerHour,
      };
    });

    return {
      dockId:             dock._id.toString(),
      dockName:           dock.dockName,
      maxCapacityPerHour: dock.maxCapacityPerHour,
      slots:              dockSlots,
    };
  });

  return { closed: false, docks: resultDocks };
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

export const getAvailability = async (req: Request, res: Response): Promise<void> => {
  try {
    const { warehouseId, date, dockId } = req.query as {
      warehouseId: string;
      date: string;
      dockId?: string;
    };

    if (!warehouseId || !date) {
      res.status(400).json({ error: 'warehouseId and date (YYYY-MM-DD) are required' });
      return;
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const result = await computeDayAvailability(warehouseId, date, warehouse, dockId);
    res.status(200).json({ ...result });
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

    if (!warehouseId || !startDate) {
      res.status(400).json({ error: 'warehouseId and startDate (YYYY-MM-DD) are required' });
      return;
    }

    // Cap at 14 days regardless of request
    const requestedDays = Math.min(parseInt(daysParam ?? '7', 10) || 7, 14);

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const [sy, sm, sd] = startDate.split('-').map(Number);
    const dayAbbrevs = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayFullNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const summary = [];

    for (let i = 0; i < requestedDays; i++) {
      // Build date string without timezone shift
      const d = new Date(sy, sm - 1, sd + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dow = d.getDay();

      const dayResult = await computeDayAvailability(warehouseId, dateStr, warehouse, dockId);

      if (dayResult.closed) {
        summary.push({
          date:        dateStr,
          dayOfWeek:   dayFullNames[dow],
          dayAbbrev:   dayAbbrevs[dow],
          isOpen:      false,
          totalSlots:  0,
          freeSlots:   0,
          fullyBooked: false,
        });
        continue;
      }

      let totalSlots = 0;
      let freeSlots  = 0;

      for (const dock of dayResult.docks) {
        totalSlots += dock.slots.length;
        freeSlots  += dock.slots.filter((s) => s.available).length;
      }

      summary.push({
        date:        dateStr,
        dayOfWeek:   dayFullNames[dow],
        dayAbbrev:   dayAbbrevs[dow],
        isOpen:      true,
        totalSlots,
        freeSlots,
        fullyBooked: totalSlots > 0 && freeSlots === 0,
      });
    }

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

    const [year, month] = monthParam.split('-').map(Number);
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const startOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

    const pipeline: any[] = [
      {
        $match: {
          warehouseId: new mongoose.Types.ObjectId(warehouseId),
          startTime: { $gte: startOfMonth, $lt: startOfNextMonth },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: 'UTC' } },
          total:      { $sum: 1 },
          pending:    { $sum: { $cond: [{ $eq: ['$status', 'PENDING']     }, 1, 0] } },
          approved:   { $sum: { $cond: [{ $eq: ['$status', 'APPROVED']    }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] } },
          completed:  { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED']   }, 1, 0] } },
          cancelled:  { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED']   }, 1, 0] } },
          rejected:   { $sum: { $cond: [{ $eq: ['$status', 'REJECTED']    }, 1, 0] } },
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
        },
      },
      { $sort: { date: 1 } },
    ];

    const summary = await Booking.aggregate(pipeline);
    res.status(200).json({ summary });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
