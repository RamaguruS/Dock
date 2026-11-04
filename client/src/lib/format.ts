// Shared labels and formatting for the supply-chain vocabulary used across the app.

export type BookingStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'NO_SHOW';

export type TrailerType = 'DRY_VAN' | 'REEFER' | 'FLATBED' | 'CONTAINER';
export type Direction = 'INBOUND' | 'OUTBOUND';
export type DockDirection = Direction | 'BOTH';

export const TRAILER_TYPES: TrailerType[] = ['DRY_VAN', 'REEFER', 'FLATBED', 'CONTAINER'];

export const TRAILER_LABEL: Record<TrailerType, string> = {
  DRY_VAN: 'Dry van',
  REEFER: 'Reefer (temp-controlled)',
  FLATBED: 'Flatbed',
  CONTAINER: 'Container',
};

export const DIRECTION_LABEL: Record<DockDirection, string> = {
  INBOUND: 'Inbound (receiving)',
  OUTBOUND: 'Outbound (shipping)',
  BOTH: 'Inbound & outbound',
};

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Confirmed',
  CHECKED_IN: 'In yard',
  IN_PROGRESS: 'At dock',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  NO_SHOW: 'No-show',
};

export interface Booking {
  _id: string;
  warehouseId: { _id: string; name: string; address: string; timezone: string } | null;
  dockId: { _id: string; dockName: string; direction?: DockDirection } | null;
  vendorId: { _id: string; username: string; email: string; vendorCompany: string } | null;
  truckNumber: string;
  driverName: string;
  driverPhone: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  direction: Direction;
  trailerType: TrailerType;
  hazmat: boolean;
  referenceNumber?: string;
  palletCount?: number;
  cargoDescription?: string;
  recurrenceGroupId?: string;
  checkedInAt?: string;
  dockStartedAt?: string;
  completedAt?: string;
  arrivalStatus?: 'ON_TIME' | 'LATE';
  lateByMinutes?: number;
  cancelReason?: string;
  rescheduleHistory?: { fromStart: string; toStart: string; at: string }[];
}

export interface CarrierScore {
  totalAppointments: number;
  completed: number;
  onTime: number;
  late: number;
  noShows: number;
  cancelled: number;
  lateCancellations: number;
  avgLateMinutes: number | null;
  onTimeRate: number | null;
  noShowRate: number | null;
  reliabilityScore: number | null;
  tier: 'A' | 'B' | 'C' | 'D' | 'NEW';
  tierLabel: string;
}

const browserTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "14:30" in the given timezone. */
export const fmtTime = (iso: string | undefined, tz = browserTZ) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
    : '—';

/** "Thu 5 Nov 2026" in the given timezone. */
export const fmtDate = (iso: string, tz = browserTZ) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** "Thu 5 Nov, 14:30" in the given timezone. */
export const fmtDateTime = (iso: string, tz = browserTZ) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

/** YYYY-MM-DD of an instant in a timezone. */
export const localDateKey = (iso: string | Date, tz = browserTZ) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    typeof iso === 'string' ? new Date(iso) : iso
  );

export const todayKey = (tz = browserTZ) => localDateKey(new Date(), tz);

export const addDaysKey = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export const tzAbbrev = (tz = browserTZ) =>
  new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? tz;

export const minutes = (a?: string, b?: string) =>
  a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : null;

/** Server errors can be a plain string or a zod `format()` object. */
export const errorMessage = (err: any, fallback = 'Something went wrong'): string => {
  const error = err?.response?.data?.error ?? err;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const messages: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node._errors)) messages.push(...node._errors);
      Object.entries(node).forEach(([k, v]) => k !== '_errors' && walk(v));
    };
    walk(error);
    if (messages.length) return messages.join(' ');
    if (typeof error.message === 'string') return error.message;
  }
  return fallback;
};

export const TIER_STYLE: Record<CarrierScore['tier'], string> = {
  A: 'bg-emerald-950 text-emerald-400 border-emerald-500/30',
  B: 'bg-sky-950 text-sky-400 border-sky-500/30',
  C: 'bg-amber-950 text-amber-400 border-amber-500/30',
  D: 'bg-red-950 text-red-400 border-red-500/30',
  NEW: 'bg-slate-900 text-slate-400 border-slate-700',
};
