/**
 * Demo data for presentations: two distribution centres, typed docks, six carriers with different
 * reliability profiles, ~5 weeks of realistic history (for analytics), a live "today" yard,
 * upcoming appointments, a weekly recurring series, a waitlist and pending approvals.
 *
 * Everything is generated relative to the current time, so reset right before a demo.
 * Enabled only when SEED_DEMO=true. Reset wipes the whole database.
 */
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { User } from '../models/User.js';
import { Warehouse } from '../models/Warehouse.js';
import { Dock, IDock, isDockCompatible, TrailerType } from '../models/Dock.js';
import { Booking, BookingStatus } from '../models/Booking.js';
import { VendorAccess } from '../models/VendorAccess.js';
import { AuditLog } from '../models/AuditLog.js';
import { Notification } from '../models/Notification.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { addDaysToDateString, generateSlotGrid, localDateString } from './scheduling.js';
import { logger } from '../config/logger.js';

export const DEMO_PASSWORD = 'Demo@123';
export const DEMO_ADMIN_EMAIL = 'admin@smartdock.demo';
export const DEMO_CARRIER_EMAIL = 'carrier@smartdock.demo';

export const isDemoMode = () => process.env.SEED_DEMO === 'true';

// Deterministic pseudo-random generator so every reset looks the same
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface CarrierProfile {
  company: string;
  username: string;
  email: string;
  onTime: number;
  late: number;
  noShow: number;
  cancel: number;
  trailers: TrailerType[];
  directions: ('INBOUND' | 'OUTBOUND')[];
  hazmat?: boolean;
  weight: number;
}

const CARRIERS: CarrierProfile[] = [
  { company: 'Swift Freight Lines', username: 'swiftfreight', email: DEMO_CARRIER_EMAIL, onTime: 0.9, late: 0.08, noShow: 0.02, cancel: 0.03, trailers: ['DRY_VAN', 'CONTAINER', 'REEFER'], directions: ['INBOUND', 'OUTBOUND'], weight: 4 },
  { company: 'Coastal Cold Chain', username: 'coastalcold', email: 'coldchain@smartdock.demo', onTime: 0.82, late: 0.14, noShow: 0.04, cancel: 0.04, trailers: ['REEFER'], directions: ['INBOUND'], weight: 3 },
  { company: 'Deccan Transport Co', username: 'deccan', email: 'deccan@smartdock.demo', onTime: 0.62, late: 0.28, noShow: 0.1, cancel: 0.06, trailers: ['DRY_VAN', 'FLATBED'], directions: ['OUTBOUND', 'INBOUND'], weight: 3 },
  { company: 'Metro Haulers', username: 'metrohaulers', email: 'metro@smartdock.demo', onTime: 0.45, late: 0.33, noShow: 0.22, cancel: 0.1, trailers: ['DRY_VAN', 'CONTAINER'], directions: ['INBOUND', 'OUTBOUND'], weight: 2 },
  { company: 'SafeChem Logistics', username: 'safechem', email: 'safechem@smartdock.demo', onTime: 0.86, late: 0.11, noShow: 0.03, cancel: 0.02, trailers: ['DRY_VAN'], directions: ['INBOUND'], hazmat: true, weight: 1 },
];

const DRIVERS = ['Ravi Kumar', 'Suresh Babu', 'Arjun Nair', 'Mohammed Irfan', 'Prakash Rao', 'Vijay Anand', 'Karthik S', 'Manoj Pillai', 'Senthil Murugan', 'Dinesh Reddy', 'Ganesh Iyer', 'Anil Joseph'];
const CARGO: Record<TrailerType, string[]> = {
  DRY_VAN: ['FMCG cartons', 'Packaged foods', 'Electronics', 'Apparel', 'Paper products'],
  REEFER: ['Frozen seafood', 'Dairy products', 'Fresh produce', 'Pharmaceuticals (2–8°C)'],
  FLATBED: ['Steel coils', 'Machinery parts', 'Construction material'],
  CONTAINER: ['Import consignment (40ft)', 'Export cartons (20ft)', 'Auto components'],
};
// Relative demand by local hour (morning and afternoon peaks)
const HOUR_WEIGHT: Record<number, number> = { 7: 0.5, 8: 0.8, 9: 1.2, 10: 1.3, 11: 1.0, 12: 0.6, 13: 0.7, 14: 1.1, 15: 1.2, 16: 0.9, 17: 0.6, 18: 0.4 };

export async function seedDemoData(): Promise<{ bookings: number }> {
  const rng = makeRng(20261105);
  const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const between = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

  // ---- Wipe ----
  await Promise.all(
    [User, Warehouse, Dock, Booking, VendorAccess, AuditLog, Notification, WaitlistEntry].map((m: any) => m.deleteMany({}))
  );

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const now = new Date();
  const TZ = 'Asia/Kolkata';
  const today = localDateString(now, TZ);

  // ---- Warehouses + admins ----
  const adminId = new Types.ObjectId();
  const adminBlrId = new Types.ObjectId();
  const chennai = await Warehouse.create({
    name: 'Chennai Central Distribution Centre',
    address: 'SIPCOT Industrial Park, Sriperumbudur, Chennai 602105',
    adminId,
    timezone: TZ,
    slotDurationMinutes: 60,
    bufferMinutes: 0,
    lateThresholdMinutes: 15,
    noShowGraceMinutes: 60,
    operatingHours: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
      day,
      start: '07:00',
      end: '19:00',
      isOpen: day !== 'sunday',
    })),
    blackoutDates: [
      { date: '2026-12-25', reason: 'Christmas holiday' },
      { date: '2027-01-15', reason: 'Pongal holiday' },
      { date: '2027-01-26', reason: 'Republic Day' },
    ],
  });
  const bengaluru = await Warehouse.create({
    name: 'Bengaluru North Fulfilment Hub',
    address: 'Hoskote Logistics Park, Bengaluru 562114',
    adminId: adminBlrId,
    timezone: TZ,
    slotDurationMinutes: 30,
    bufferMinutes: 10,
    operatingHours: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
      day,
      start: '08:00',
      end: '18:00',
      isOpen: !['saturday', 'sunday'].includes(day),
    })),
  });

  await User.create([
    { _id: adminId, username: 'chennai_dc_manager', email: DEMO_ADMIN_EMAIL, passwordHash, role: 'WAREHOUSE_ADMIN', warehouseId: chennai._id },
    { _id: adminBlrId, username: 'blr_hub_manager', email: 'admin.blr@smartdock.demo', passwordHash, role: 'WAREHOUSE_ADMIN', warehouseId: bengaluru._id },
  ]);

  // ---- Docks ----
  const docks = await Dock.create([
    { warehouseId: chennai._id, dockName: 'D-01 Inbound Dry', direction: 'INBOUND', supportedTrailerTypes: ['DRY_VAN', 'CONTAINER'], maxCapacityPerHour: 2 },
    { warehouseId: chennai._id, dockName: 'D-02 Cold Chain (Reefer)', direction: 'INBOUND', supportedTrailerTypes: ['REEFER'], maxCapacityPerHour: 1 },
    { warehouseId: chennai._id, dockName: 'D-03 Outbound Dispatch', direction: 'OUTBOUND', supportedTrailerTypes: ['DRY_VAN', 'CONTAINER', 'FLATBED'], maxCapacityPerHour: 2 },
    { warehouseId: chennai._id, dockName: 'D-04 Hazmat Bay', direction: 'BOTH', supportedTrailerTypes: ['DRY_VAN', 'CONTAINER'], hazmatCertified: true, maxCapacityPerHour: 1 },
    { warehouseId: chennai._id, dockName: 'D-05 Flatbed / Oversize', direction: 'BOTH', supportedTrailerTypes: ['FLATBED'], maxCapacityPerHour: 1 },
  ]);
  await Dock.create([
    { warehouseId: bengaluru._id, dockName: 'B-01 Receiving', direction: 'INBOUND', supportedTrailerTypes: ['DRY_VAN', 'REEFER', 'CONTAINER'], maxCapacityPerHour: 2 },
    { warehouseId: bengaluru._id, dockName: 'B-02 Shipping', direction: 'OUTBOUND', supportedTrailerTypes: ['DRY_VAN', 'CONTAINER'], maxCapacityPerHour: 2 },
  ]);

  // ---- Carriers + access ----
  const carriers = await User.create(
    CARRIERS.map((c) => ({ username: c.username, email: c.email, passwordHash, role: 'VENDOR', vendorCompany: c.company, status: 'APPROVED' }))
  );
  const nova = await User.create({
    username: 'novamovers', email: 'nova@smartdock.demo', passwordHash, role: 'VENDOR', vendorCompany: 'Nova Movers', status: 'APPROVED',
  });
  const decided = new Date(now.getTime() - 40 * 86400000);
  await VendorAccess.create([
    ...carriers.map((c) => ({ vendorId: c._id, warehouseId: chennai._id, status: 'APPROVED', decidedBy: adminId, decidedAt: decided })),
    { vendorId: carriers[0]._id, warehouseId: bengaluru._id, status: 'APPROVED', decidedBy: adminBlrId, decidedAt: decided },
    { vendorId: carriers[2]._id, warehouseId: bengaluru._id, status: 'PENDING' },
    { vendorId: nova._id, warehouseId: chennai._id, status: 'PENDING' },
  ]);

  // ---- Bookings ----
  const used = new Map<string, number>();
  const docs: Record<string, unknown>[] = [];
  const truck = () => `TN ${String(between(1, 99)).padStart(2, '0')} ${String.fromCharCode(65 + between(0, 25))}${String.fromCharCode(65 + between(0, 25))} ${between(1000, 9999)}`;
  const phone = () => `+91 9${between(100000000, 999999999)}`;

  const compatibleCarriers = (dock: IDock) =>
    CARRIERS.map((profile, i) => ({ profile, user: carriers[i] })).filter(({ profile }) =>
      profile.trailers.some((t) =>
        profile.directions.some((dir) => isDockCompatible(dock, { trailerType: t, direction: dir, hazmat: !!profile.hazmat && dock.hazmatCertified }))
      )
    );

  const loadFor = (dock: IDock, profile: CarrierProfile) => {
    const trailers = profile.trailers.filter((t) => dock.supportedTrailerTypes.includes(t));
    const dirs = profile.directions.filter((d) => dock.direction === 'BOTH' || dock.direction === d);
    const trailerType = pick(trailers);
    return {
      trailerType,
      direction: pick(dirs),
      hazmat: !!profile.hazmat && dock.hazmatCertified,
      cargoDescription: profile.hazmat ? 'Class 3 flammable liquids (UN1993)' : pick(CARGO[trailerType]),
      palletCount: trailerType === 'FLATBED' ? between(4, 12) : between(10, 33),
    };
  };

  const addBooking = (
    dock: IDock,
    slot: { startUTC: Date; endUTC: Date },
    who: { profile: CarrierProfile; user: { _id: Types.ObjectId } },
    status: BookingStatus,
    extra: Record<string, unknown> = {}
  ) => {
    const key = `${dock._id}|${slot.startUTC.toISOString()}`;
    const count = used.get(key) ?? 0;
    if (count >= dock.maxCapacityPerHour) return false;
    used.set(key, count + 1);
    const createdAt = new Date(Math.min(slot.startUTC.getTime() - between(1, 6) * 86400000, now.getTime() - 3600000));
    docs.push({
      warehouseId: chennai._id,
      dockId: dock._id,
      vendorId: who.user._id,
      truckNumber: truck(),
      driverName: pick(DRIVERS),
      driverPhone: phone(),
      startTime: slot.startUTC,
      endTime: slot.endUTC,
      status,
      referenceNumber: `${rng() < 0.6 ? 'PO' : 'ASN'}-${between(4500000, 4599999)}`,
      rescheduleHistory: [],
      createdAt,
      updatedAt: createdAt,
      ...loadFor(dock, who.profile),
      ...extra,
    });
    return true;
  };

  /** Realistic yard timeline for an appointment that arrived. */
  const arrivalTimes = (slotStart: Date, late: boolean, hour: number, trailer: string) => {
    const offset = late ? between(16, 55) : between(-15, 12);
    const checkedInAt = new Date(slotStart.getTime() + offset * 60000);
    const peak = (HOUR_WEIGHT[hour] ?? 0.5) > 1;
    const dockStartedAt = new Date(checkedInAt.getTime() + between(5, peak ? 40 : 20) * 60000);
    const handling = trailer === 'REEFER' ? between(35, 60) : trailer === 'FLATBED' ? between(30, 50) : between(25, 50);
    const completedAt = new Date(dockStartedAt.getTime() + handling * 60000);
    return { checkedInAt, dockStartedAt, completedAt, arrivalStatus: late ? 'LATE' : 'ON_TIME', lateByMinutes: Math.max(0, offset) };
  };

  const localHour = (d: Date) => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d));

  for (let offset = -35; offset <= 21; offset++) {
    const date = addDaysToDateString(today, offset);
    const grid = generateSlotGrid(chennai, date);
    if (grid.closed) continue;

    for (const slot of grid.slots) {
      const hour = localHour(slot.startUTC);
      for (const dock of docks) {
        if (dock.dockName.startsWith('D-05') && offset === 1) continue; // maintenance tomorrow
        const pool = compatibleCarriers(dock);
        const base = offset < 0 ? 0.55 : offset === 0 ? 0.6 : Math.max(0.12, 0.45 - offset * 0.02);
        for (let place = 0; place < dock.maxCapacityPerHour; place++) {
          if (rng() > base * (HOUR_WEIGHT[hour] ?? 0.5) * (place === 0 ? 1 : 0.6)) continue;
          // weighted carrier choice
          const total = pool.reduce((s, c) => s + c.profile.weight, 0);
          let r = rng() * total;
          const who = pool.find((c) => (r -= c.profile.weight) < 0) ?? pool[0];
          const p = who.profile;

          let status: BookingStatus;
          let extra: Record<string, unknown> = {};
          const ended = slot.endUTC <= now;
          const started = slot.startUTC <= now;

          if (offset < 0 || ended) {
            const roll = rng();
            if (roll < p.cancel) {
              status = 'CANCELLED';
              extra = { cancelReason: pick(['Shipment delayed at origin', 'Vehicle breakdown', 'PO quantity changed']), updatedAt: new Date(slot.startUTC.getTime() - between(26, 72) * 3600000) };
            } else if (roll < p.cancel + p.noShow) {
              status = 'NO_SHOW';
            } else {
              status = 'COMPLETED';
              const late = rng() < p.late / (p.onTime + p.late);
              const trailer = loadFor(dock, p).trailerType;
              extra = arrivalTimes(slot.startUTC, late, hour, trailer);
              extra.trailerType = trailer;
            }
          } else if (started) {
            // Happening now
            const late = rng() < 0.25;
            const t = arrivalTimes(slot.startUTC, late, hour, 'DRY_VAN');
            if (t.checkedInAt > now) t.checkedInAt = new Date(now.getTime() - 5 * 60000);
            status = rng() < 0.6 ? 'IN_PROGRESS' : 'CHECKED_IN';
            extra = { checkedInAt: t.checkedInAt, arrivalStatus: t.arrivalStatus, lateByMinutes: t.lateByMinutes };
            if (status === 'IN_PROGRESS') extra.dockStartedAt = new Date(Math.min(t.dockStartedAt.getTime(), now.getTime() - 60000));
          } else if (offset === 0 && slot.startUTC.getTime() - now.getTime() < 45 * 60000 && rng() < 0.4) {
            status = 'CHECKED_IN';
            extra = { checkedInAt: new Date(now.getTime() - between(2, 15) * 60000), arrivalStatus: 'ON_TIME', lateByMinutes: 0 };
          } else {
            status = rng() < (offset <= 2 ? 0.75 : 0.6) ? 'APPROVED' : 'PENDING';
          }
          addBooking(dock, slot, who, status, extra);
        }
      }
    }
  }

  // ---- Weekly recurring series: Swift Freight, every Tuesday 09:00 at D-01, 6 weeks ----
  const groupId = new mongoose.Types.ObjectId().toString();
  let tuesday = today;
  for (let i = 1; i <= 7; i++) {
    const d = addDaysToDateString(today, i);
    const [y, m, dd] = d.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() === 2) { tuesday = d; break; }
  }
  const swift = { profile: CARRIERS[0], user: carriers[0] };
  for (let w = 0; w < 6; w++) {
    const slot = generateSlotGrid(chennai, addDaysToDateString(tuesday, 7 * w)).slots.find((s) => s.startLocal === '09:00');
    if (!slot) continue;
    // free a place if random demand already filled it
    const key = `${docks[0]._id}|${slot.startUTC.toISOString()}`;
    if ((used.get(key) ?? 0) >= docks[0].maxCapacityPerHour) {
      const idx = docs.findIndex((d) => d.dockId === docks[0]._id && (d.startTime as Date).getTime() === slot.startUTC.getTime());
      if (idx >= 0) {
        docs.splice(idx, 1);
        used.set(key, (used.get(key) ?? 1) - 1);
      }
    }
    addBooking(docks[0], slot, swift, 'APPROVED', {
      recurrenceGroupId: groupId,
      truckNumber: 'TN 09 SF 4521',
      driverName: 'Ravi Kumar',
      trailerType: 'CONTAINER',
      direction: 'INBOUND',
      cargoDescription: 'Weekly FMCG replenishment',
      referenceNumber: `ASN-SF-${4500 + w}`,
    });
  }

  // ---- Tomorrow: reefer door full at 10:00 + a waitlisted carrier ----
  let nextOpen = addDaysToDateString(today, 1);
  while (generateSlotGrid(chennai, nextOpen).closed) nextOpen = addDaysToDateString(nextOpen, 1);
  const reefer = docks[1];
  const tenAm = generateSlotGrid(chennai, nextOpen).slots.find((s) => s.startLocal === '10:00')!;
  const reeferKey = `${reefer._id}|${tenAm.startUTC.toISOString()}`;
  if (!used.get(reeferKey)) addBooking(reefer, tenAm, { profile: CARRIERS[1], user: carriers[1] }, 'APPROVED');

  // ---- Maintenance window on D-05 tomorrow 10:00–13:00 ----
  const maintStart = generateSlotGrid(chennai, nextOpen).slots.find((s) => s.startLocal === '10:00')!.startUTC;
  const maintEnd = generateSlotGrid(chennai, nextOpen).slots.find((s) => s.startLocal === '12:00')!.endUTC;
  await Dock.updateOne(
    { _id: docks[4]._id },
    { $push: { maintenanceWindows: { startTime: maintStart, endTime: maintEnd, reason: 'Dock leveller hydraulic repair' } } }
  );

  await Booking.insertMany(docs, { timestamps: false } as any);

  await WaitlistEntry.create({
    vendorId: carriers[0]._id,
    warehouseId: chennai._id,
    dockId: reefer._id,
    startTime: tenAm.startUTC,
    endTime: tenAm.endUTC,
    direction: 'INBOUND',
    trailerType: 'REEFER',
    truckNumber: 'TN 22 SF 8890',
    driverName: 'Arjun Nair',
    driverPhone: '+91 9840012345',
    referenceNumber: 'PO-4512277',
    palletCount: 18,
  });

  // ---- Activity log + notifications so the panels aren't empty ----
  const recent = docs
    .filter((d) => Math.abs((d.startTime as Date).getTime() - now.getTime()) < 2 * 86400000)
    .slice(0, 30);
  await AuditLog.insertMany(
    [
      { warehouseId: chennai._id, actorId: adminId, actorRole: 'WAREHOUSE_ADMIN', actorName: 'chennai_dc_manager', action: 'SCHEDULING_SETTINGS_UPDATED', entityType: 'WAREHOUSE', entityId: chennai._id.toString(), message: 'Scheduling rules: 60-min slots, 0-min buffer, late after 15 min, no-show after 60 min', createdAt: new Date(now.getTime() - 3 * 86400000) },
      { warehouseId: chennai._id, actorId: adminId, actorRole: 'WAREHOUSE_ADMIN', actorName: 'chennai_dc_manager', action: 'MAINTENANCE_SCHEDULED', entityType: 'DOCK', entityId: docks[4]._id.toString(), message: `Maintenance on D-05 Flatbed / Oversize: Dock leveller hydraulic repair (${nextOpen} 10:00–13:00)`, createdAt: new Date(now.getTime() - 86400000) },
      { warehouseId: chennai._id, actorId: nova._id, actorRole: 'VENDOR', actorName: 'Nova Movers (novamovers)', action: 'VENDOR_ACCESS_REQUESTED', entityType: 'VENDOR_ACCESS', message: 'Carrier Nova Movers requested access', createdAt: new Date(now.getTime() - 5 * 3600000) },
      ...recent.map((d, i) => {
        const carrier = CARRIERS.find((c, idx) => carriers[idx]._id.equals(d.vendorId as Types.ObjectId));
        return {
          warehouseId: chennai._id,
          actorRole: 'VENDOR',
          actorName: carrier?.company,
          action: 'BOOKING_CREATED',
          entityType: 'BOOKING',
          message: `${carrier?.company} requested an appointment for truck ${d.truckNumber}`,
          createdAt: new Date(now.getTime() - (i + 1) * 47 * 60000),
        };
      }),
    ],
    { timestamps: false } as any
  );

  await Notification.create([
    { userId: adminId, type: 'VENDOR_ACCESS_REQUESTED', title: 'New carrier access request', message: 'Nova Movers wants to book dock appointments at your warehouse.' },
    { userId: adminId, type: 'WAITLIST_JOINED', title: 'Carrier joined the waitlist', message: `Truck TN 22 SF 8890 is waiting for D-02 Cold Chain at 10:00 on ${nextOpen} (position 1).` },
    { userId: carriers[0]._id, type: 'BOOKING_APPROVED', title: 'Appointment approved', message: 'Your weekly Tuesday 09:00 series at Chennai Central DC has been approved.' },
  ]);

  logger.info(`[SEED] Demo data created: ${docs.length} appointments`);
  return { bookings: docs.length };
}

/** Seed on startup when SEED_DEMO=true and the database has no demo admin yet. */
export async function seedIfEmpty(): Promise<void> {
  if (!isDemoMode()) return;
  const exists = await User.exists({ email: DEMO_ADMIN_EMAIL });
  if (exists) return;
  await seedDemoData();
}
