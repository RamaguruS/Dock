/**
 * Scheduling engine: slot grid generation, availability, and atomic capacity reservation.
 *
 * Slot grid per warehouse day:
 *   opening time → slots of `slotDurationMinutes`, separated by `bufferMinutes` of turnover time,
 *   until closing time. Blackout dates close the whole day. Dock maintenance windows block
 *   overlapping slots on that dock. Docks are filtered by load compatibility
 *   (inbound/outbound, trailer type, hazmat).
 */
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { Booking, INACTIVE_STATUSES } from '../models/Booking.js';
import { Dock, IDock, isDockCompatible, LoadRequirements } from '../models/Dock.js';
import { IWarehouse } from '../models/Warehouse.js';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

// Creating an Intl.DateTimeFormat is expensive (ICU setup); cache one per timezone + pattern.
const formatterCache = new Map<string, Intl.DateTimeFormat>();
export function cachedFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

/** Convert a local date (YYYY-MM-DD) + HH:mm in an IANA timezone to the exact UTC instant (DST-safe). */
export function localTimeToUTC(dateStr: string, timeStr: string, timezone: string): Date {
  const formatter = cachedFormatter('en-US', {
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
  const target = Date.UTC(year, month - 1, day, hour, minute);

  let utcDate = new Date(target);
  for (let i = 0; i < 3; i++) {
    const parts: Record<string, string> = {};
    formatter.formatToParts(utcDate).forEach((p) => { parts[p.type] = p.value; });
    let fHour = parseInt(parts.hour);
    if (fHour === 24) fHour = 0;
    const seen = Date.UTC(parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day), fHour, parseInt(parts.minute));
    const diffMs = target - seen;
    if (diffMs === 0) break;
    utcDate = new Date(utcDate.getTime() + diffMs);
  }
  return utcDate;
}

/** YYYY-MM-DD of an instant as seen in the given IANA timezone. */
export function localDateString(instant: Date, timezone: string): string {
  return cachedFormatter('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Local weekday index (0 = Sunday) and hour of an instant in a timezone. */
export function localWeekdayHour(instant: Date, timezone: string): { weekday: number; hour: number } {
  const parts: Record<string, string> = {};
  cachedFormatter('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', hour12: false })
    .formatToParts(instant)
    .forEach((p) => { parts[p.type] = p.value; });
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  let hour = parseInt(parts.hour);
  if (hour === 24) hour = 0;
  return { weekday, hour };
}

/** Add days to a YYYY-MM-DD string (calendar arithmetic, no timezone involved). */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

// ---------------------------------------------------------------------------
// Slot grid
// ---------------------------------------------------------------------------

export type WarehouseSchedule = Pick<
  IWarehouse,
  'timezone' | 'operatingHours' | 'slotDurationMinutes' | 'bufferMinutes' | 'blackoutDates'
>;

export interface GridSlot {
  startLocal: string;
  endLocal: string;
  startUTC: Date;
  endUTC: Date;
}

export interface SlotGrid {
  closed: boolean;
  message?: string;
  slots: GridSlot[];
}

/** The slots a warehouse offers on a local date (before looking at docks or bookings). */
export function generateSlotGrid(warehouse: WarehouseSchedule, date: string): SlotGrid {
  const blackout = (warehouse.blackoutDates ?? []).find((b) => b.date === date);
  if (blackout) {
    return { closed: true, message: `Closed: ${blackout.reason}`, slots: [] };
  }

  const [year, month, day] = date.split('-').map(Number);
  const dayOfWeek = DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const opHours = warehouse.operatingHours.find((oh) => oh.day === dayOfWeek);
  if (!opHours || !opHours.isOpen) {
    return { closed: true, message: 'Warehouse is closed on this day', slots: [] };
  }

  const duration = warehouse.slotDurationMinutes || 60;
  const buffer = warehouse.bufferMinutes || 0;
  const open = toMinutes(opHours.start);
  const close = toMinutes(opHours.end);

  const slots: GridSlot[] = [];
  for (let t = open; t + duration <= close; t += duration + buffer) {
    const startLocal = toHHMM(t);
    const endLocal = toHHMM(t + duration);
    slots.push({
      startLocal,
      endLocal,
      startUTC: localTimeToUTC(date, startLocal, warehouse.timezone),
      endUTC: localTimeToUTC(date, endLocal, warehouse.timezone),
    });
  }
  return { closed: false, slots };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type SlotBlockReason = 'FULL' | 'MAINTENANCE' | 'PAST';

export interface DockSlotDetail {
  startTime: string; // ISO UTC
  endTime: string;   // ISO UTC
  localTime: string; // "09:00 - 10:00" in warehouse time
  available: boolean;
  remainingCapacity: number;
  maxCapacity: number;
  reason?: SlotBlockReason;
  maintenanceReason?: string;
}

export interface DockAvailabilityDetail {
  dockId: string;
  dockName: string;
  maxCapacityPerHour: number;
  direction: string;
  supportedTrailerTypes: string[];
  hazmatCertified: boolean;
  slots: DockSlotDetail[];
}

export interface DayAvailabilityResult {
  closed: boolean;
  message?: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  docks: DockAvailabilityDetail[];
}

/**
 * Full availability for one local date. Only active docks compatible with `load` are returned.
 * Pass `filterDockId` to restrict to one dock.
 */
export async function computeDayAvailability(
  warehouseId: string,
  date: string,
  warehouse: WarehouseSchedule,
  options: { filterDockId?: string; load?: LoadRequirements } = {}
): Promise<DayAvailabilityResult> {
  const base = {
    slotDurationMinutes: warehouse.slotDurationMinutes || 60,
    bufferMinutes: warehouse.bufferMinutes || 0,
  };
  const grid = generateSlotGrid(warehouse, date);
  if (grid.closed) return { closed: true, message: grid.message, docks: [], ...base };

  const dockQuery: Record<string, unknown> = { warehouseId, isActive: true };
  if (options.filterDockId) dockQuery._id = options.filterDockId;
  const docks = (await Dock.find(dockQuery).sort({ dockName: 1 })).filter((d) =>
    isDockCompatible(d, options.load ?? {})
  );

  if (docks.length === 0) {
    const message = options.load && (options.load.trailerType || options.load.direction || options.load.hazmat)
      ? 'No active dock can handle this load type'
      : 'No active docks in this warehouse';
    return { closed: false, message, docks: [], ...base };
  }
  if (grid.slots.length === 0) {
    return { closed: false, message: 'No slots fit inside the operating hours', docks: [], ...base };
  }

  const dayStart = grid.slots[0].startUTC;
  const dayEnd = grid.slots[grid.slots.length - 1].endUTC;
  const bookings = await Booking.find({
    warehouseId,
    dockId: { $in: docks.map((d) => d._id) },
    status: { $nin: INACTIVE_STATUSES },
    startTime: { $lt: dayEnd },
    endTime: { $gt: dayStart },
  }).select('dockId startTime endTime');

  const now = new Date();

  return {
    closed: false,
    ...base,
    docks: docks.map((dock) => ({
      dockId: dock._id.toString(),
      dockName: dock.dockName,
      maxCapacityPerHour: dock.maxCapacityPerHour,
      direction: dock.direction,
      supportedTrailerTypes: dock.supportedTrailerTypes,
      hazmatCertified: dock.hazmatCertified,
      slots: grid.slots.map((slot) => {
        const used = bookings.filter(
          (b) => b.dockId.toString() === dock._id.toString() && overlaps(b.startTime, b.endTime, slot.startUTC, slot.endUTC)
        ).length;
        const remaining = Math.max(0, dock.maxCapacityPerHour - used);
        const maintenance = (dock.maintenanceWindows ?? []).find((w) =>
          overlaps(w.startTime, w.endTime, slot.startUTC, slot.endUTC)
        );

        let reason: SlotBlockReason | undefined;
        if (slot.startUTC <= now) reason = 'PAST';
        else if (maintenance) reason = 'MAINTENANCE';
        else if (remaining === 0) reason = 'FULL';

        return {
          startTime: slot.startUTC.toISOString(),
          endTime: slot.endUTC.toISOString(),
          localTime: `${slot.startLocal} - ${slot.endLocal}`,
          available: !reason,
          remainingCapacity: maintenance ? 0 : remaining,
          maxCapacity: dock.maxCapacityPerHour,
          reason,
          maintenanceReason: maintenance?.reason,
        };
      }),
    })),
  };
}

export type SlotValidation =
  | { ok: true; dock: IDock; localTime: string }
  | { ok: false; status: number; error: string };

/**
 * Validate that [startTime, endTime) on `dockId` is a real, future, bookable slot for this load.
 * Capacity is NOT checked here (that happens atomically in reserveCapacity).
 */
export async function validateSlotRequest(
  warehouseId: string,
  warehouse: WarehouseSchedule,
  dockId: string,
  startTime: Date,
  endTime: Date,
  load: LoadRequirements
): Promise<SlotValidation> {
  if (startTime >= endTime) return { ok: false, status: 400, error: 'Start time must be before end time' };
  if (startTime <= new Date()) return { ok: false, status: 400, error: 'Start time must be in the future' };

  const dock = await Dock.findOne({ _id: dockId, warehouseId, isActive: true });
  if (!dock) return { ok: false, status: 400, error: 'Selected dock is inactive or does not belong to this warehouse' };

  if (!isDockCompatible(dock, load)) {
    return {
      ok: false,
      status: 400,
      error: `${dock.dockName} cannot handle this load (direction / trailer type / hazmat requirements)`,
    };
  }

  const grid = generateSlotGrid(warehouse, localDateString(startTime, warehouse.timezone));
  if (grid.closed) return { ok: false, status: 400, error: grid.message ?? 'Warehouse is closed on this day' };

  const slot = grid.slots.find(
    (s) => s.startUTC.getTime() === startTime.getTime() && s.endUTC.getTime() === endTime.getTime()
  );
  if (!slot) {
    return {
      ok: false,
      status: 400,
      error: 'Requested time does not match an available slot within the warehouse operating hours',
    };
  }

  const maintenance = (dock.maintenanceWindows ?? []).find((w) => overlaps(w.startTime, w.endTime, startTime, endTime));
  if (maintenance) {
    return { ok: false, status: 400, error: `${dock.dockName} is under maintenance at this time (${maintenance.reason})` };
  }

  return { ok: true, dock, localTime: `${slot.startLocal} - ${slot.endLocal}` };
}

// ---------------------------------------------------------------------------
// Atomic capacity reservation
// ---------------------------------------------------------------------------
//
// Two layers:
// 1. An in-process lock per dock, so concurrent requests handled by this Node process run one at a time.
// 2. A MongoDB transaction that first WRITES the dock document (bookingLockVersion++).
//    Any two transactions booking the same dock now touch the same document, so MongoDB raises a
//    WriteConflict on one of them. withTransaction() retries it, and the retry sees the committed
//    booking. This keeps the guarantee across multiple server instances.
//
// A plain "find overlap, then insert" inside a transaction is NOT enough: both transactions read
// their own snapshot, see no conflict, insert different documents and both commit.
//
// Standalone MongoDB (no replica set) cannot run transactions, so only layer 1 applies there.
// That is safe for a single server process (local development) but not for multiple instances.

export class SlotFullError extends Error {}

const dockLocks = new Map<string, Promise<void>>();

async function withDockLock<T>(dockId: string, fn: () => Promise<T>): Promise<T> {
  const previous = dockLocks.get(dockId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  dockLocks.set(dockId, tail);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (dockLocks.get(dockId) === tail) dockLocks.delete(dockId);
  }
}

let transactionsSupported: boolean | undefined;

const isTransactionUnsupportedError = (error: any): boolean =>
  error?.message?.includes('replica set') ||
  error?.message?.includes('Transaction numbers') ||
  error?.code === 20 ||
  error?.codeName === 'IllegalOperation';

/**
 * Atomically: check that fewer than `capacity` active bookings overlap [start, end) on the dock
 * (ignoring `excludeBookingId`, used when rescheduling), then run `write`.
 * Throws SlotFullError when the slot is full.
 */
export async function reserveCapacity<T>(
  params: { dockId: string; startTime: Date; endTime: Date; capacity: number; excludeBookingId?: string },
  write: (session?: mongoose.ClientSession) => Promise<T>
): Promise<T> {
  const { dockId, startTime, endTime, capacity, excludeBookingId } = params;

  const checkAndWrite = async (session?: mongoose.ClientSession) => {
    if (session) {
      // Take a write lock on the dock document (see comment above)
      await Dock.updateOne({ _id: dockId }, { $inc: { bookingLockVersion: 1 } }, { session });
    }
    const filter: Record<string, unknown> = {
      dockId,
      status: { $nin: INACTIVE_STATUSES },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    };
    if (excludeBookingId) filter._id = { $ne: excludeBookingId };

    const overlapping = await Booking.countDocuments(filter).session(session ?? null);
    if (overlapping >= capacity) throw new SlotFullError('Selected dock slot is fully booked');
    return write(session);
  };

  return withDockLock(dockId, async () => {
    if (transactionsSupported !== false) {
      const session = await mongoose.startSession();
      try {
        let result: T | undefined;
        await session.withTransaction(async () => {
          result = await checkAndWrite(session);
        });
        transactionsSupported = true;
        return result as T;
      } catch (error) {
        if (!isTransactionUnsupportedError(error)) throw error;
        transactionsSupported = false;
        logger.warn(
          '[BOOKING] MongoDB transactions are unavailable (standalone server). Falling back to the in-process ' +
          'dock lock, which is only safe with a single server instance. Use a replica set (e.g. Atlas) in production.'
        );
      } finally {
        await session.endSession();
      }
    }
    return checkAndWrite();
  });
}
