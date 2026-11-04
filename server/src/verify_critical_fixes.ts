/**
 * End-to-end check of the critical fixes, run against TWO real server processes that share a
 * throwaway in-memory MongoDB replica set (so the cross-instance double-booking guarantee is exercised,
 * not just the in-process lock).
 *
 *   npm run verify:critical
 *
 * Covers:
 *  1. SUPER_ADMIN cannot be self-registered.
 *  2. Concurrent bookings never exceed a dock's capacity (capacity 1 and capacity 3), across instances.
 *  3. Capacity > 1 is actually usable, and bookings must match a real slot inside operating hours.
 *  4. Vendor approval is per warehouse: other warehouses' admins can't see or decide it, and vendors
 *     can only book where they're approved.
 *  Plus: booking status lifecycle (no reviving terminal bookings).
 */
import { spawn, ChildProcess } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORTS = [5101, 5102];
const JWT_SECRET = 'verify_critical_fixes_secret';
const CONCURRENT_REQUESTS = 40;

type Result = { status: number; data: any };

let failures = 0;
const check = (condition: boolean, label: string, detail?: unknown) => {
  if (condition) {
    console.log(`  \x1b[32m✔\x1b[0m ${label}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✘ ${label}\x1b[0m`, detail ?? '');
  }
};

const call = async (port: number, method: string, path: string, token?: string, body?: unknown): Promise<Result> => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, data };
};

const startServer = (port: number, mongoUri: string, logs: string[]): ChildProcess => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, PORT: String(port), MONGO_URI: mongoUri, JWT_SECRET, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => logs.push(d.toString()));
  child.stderr?.on('data', (d) => logs.push(d.toString()));
  return child;
};

const waitForServer = async (port: number) => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await call(port, 'GET', '/api/warehouses'); // touches the DB
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server on port ${port} did not become ready`);
};

/** Next Monday–Friday date (YYYY-MM-DD) at least 2 days out. */
const nextWeekday = (): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function main() {
  console.log('Starting in-memory MongoDB replica set...');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const mongoUri = replSet.getUri('smartdock_verify');

  const logs: string[] = [];
  const servers = PORTS.map((p) => startServer(p, mongoUri, logs));
  const [A, B] = PORTS;

  try {
    await Promise.all(PORTS.map(waitForServer));
    console.log(`Two API instances running on ports ${PORTS.join(' and ')}.\n`);

    // ------------------------------------------------------------------
    console.log('1. Super admin self-registration');
    const superReg = await call(A, 'POST', '/api/auth/register', undefined, {
      username: 'eviladmin', email: 'evil@example.com', password: 'password123', role: 'SUPER_ADMIN',
    });
    check(superReg.status === 400, 'public SUPER_ADMIN registration is rejected', superReg);

    // ------------------------------------------------------------------
    console.log('\n4. Per-warehouse vendor approval');
    const regAdmin = async (n: string, timezone: string) => {
      const r = await call(A, 'POST', '/api/auth/register', undefined, {
        username: `admin${n}`, email: `admin${n}@example.com`, password: 'password123', role: 'WAREHOUSE_ADMIN',
        warehouseName: `Warehouse ${n}`, warehouseAddress: `${n} Dock Street`, timezone,
      });
      const login = await call(A, 'POST', '/api/auth/login', undefined, { email: `admin${n}@example.com`, password: 'password123' });
      return { warehouseId: r.data.warehouse._id as string, token: login.data.token as string };
    };
    const whA = await regAdmin('a', 'America/New_York');
    const whB = await regAdmin('b', 'UTC');

    const noWarehouseVendor = await call(A, 'POST', '/api/auth/register', undefined, {
      username: 'novendor', email: 'novendor@example.com', password: 'password123', role: 'VENDOR',
      vendorCompany: 'Nowhere Ltd', warehouseIds: [],
    });
    check(noWarehouseVendor.status === 400, 'vendor must request at least one warehouse', noWarehouseVendor.status);

    const vendorReg = await call(A, 'POST', '/api/auth/register', undefined, {
      username: 'carrier', email: 'carrier@example.com', password: 'password123', role: 'VENDOR',
      vendorCompany: 'Carrier Co', warehouseIds: [whA.warehouseId],
    });
    check(vendorReg.status === 201, 'vendor registers requesting warehouse A', vendorReg);
    const vendorId = vendorReg.data.user._id;

    const vendorLogin = await call(A, 'POST', '/api/auth/login', undefined, { email: 'carrier@example.com', password: 'password123' });
    check(vendorLogin.status === 200, 'vendor can log in before approval (to see their access status)', vendorLogin.status);
    const vendorToken = vendorLogin.data.token;

    const today = nextWeekday();
    const preApproval = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whA.warehouseId}&date=${today}`, vendorToken);
    check(preApproval.status === 403, 'unapproved vendor cannot read availability', preApproval.status);

    const pendingB = await call(A, 'GET', '/api/vendors/pending', whB.token);
    check(
      pendingB.status === 200 && !pendingB.data.vendors.some((v: any) => v._id === vendorId),
      "warehouse B's admin does not see warehouse A's request",
      pendingB.data
    );
    const approveByB = await call(A, 'PATCH', `/api/vendors/${vendorId}/status`, whB.token, { status: 'APPROVED' });
    check(approveByB.status === 404, "warehouse B's admin cannot approve it", approveByB);

    const pendingA = await call(A, 'GET', '/api/vendors/pending', whA.token);
    check(pendingA.data.vendors?.some((v: any) => v._id === vendorId), "warehouse A's admin sees the request");
    const approveByA = await call(A, 'PATCH', `/api/vendors/${vendorId}/status`, whA.token, { status: 'APPROVED' });
    check(approveByA.status === 200 && approveByA.data.access.status === 'APPROVED', "warehouse A's admin approves it", approveByA);

    const availB = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whB.warehouseId}&date=${today}`, vendorToken);
    check(availB.status === 403, 'approved-at-A vendor still blocked at warehouse B', availB.status);

    const reqB = await call(A, 'POST', '/api/vendors/me/access', vendorToken, { warehouseId: whB.warehouseId });
    check(reqB.status === 201, 'vendor can request access to warehouse B', reqB);
    const reqBAgain = await call(A, 'POST', '/api/vendors/me/access', vendorToken, { warehouseId: whB.warehouseId });
    check(reqBAgain.status === 409, 'duplicate access request is rejected', reqBAgain.status);

    // ------------------------------------------------------------------
    console.log('\n2/3. Capacity and atomic booking (40 concurrent requests across 2 instances)');
    const dock = async (name: string, cap: number) =>
      (await call(A, 'POST', '/api/docks', whA.token, { dockName: name, maxCapacityPerHour: cap })).data.dock._id as string;
    const dockSingle = await dock('Bay 1', 1);
    const dockTriple = await dock('Bay 2', 3);

    const avail = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whA.warehouseId}&date=${today}`, vendorToken);
    const slotFor = (dockId: string) => avail.data.docks.find((d: any) => d.dockId === dockId).slots[1]; // 09:00 local
    const slot1 = slotFor(dockSingle);
    const slot3 = slotFor(dockTriple);

    const book = (port: number, dockId: string, startTime: string, endTime: string, i = 0) =>
      call(port, 'POST', '/api/bookings', vendorToken, {
        warehouseId: whA.warehouseId, dockId, truckNumber: `TRK-${i}`, driverName: `Driver ${i}`,
        driverPhone: '555-0100', startTime, endTime,
      });

    const shift = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
    const misaligned = await book(A, dockSingle, shift(slot1.startTime, 15), shift(slot1.endTime, 15));
    check(misaligned.status === 400, 'booking not aligned to a slot is rejected', misaligned);
    const offHours = await book(A, dockSingle, shift(slot1.startTime, -6 * 60), shift(slot1.endTime, -6 * 60));
    check(offHours.status === 400, 'booking outside operating hours (03:00) is rejected', offHours);

    const burst = async (dockId: string, slot: any) => {
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => book(PORTS[i % 2], dockId, slot.startTime, slot.endTime, i))
      );
      const counts: Record<number, number> = {};
      results.forEach((r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
      return counts;
    };

    const single = await burst(dockSingle, slot1);
    check(single[201] === 1 && single[409] === CONCURRENT_REQUESTS - 1, 'capacity 1: exactly 1 booking created, rest 409', single);

    const triple = await burst(dockTriple, slot3);
    check(triple[201] === 3 && triple[409] === CONCURRENT_REQUESTS - 3, 'capacity 3: exactly 3 bookings created, rest 409', triple);

    const availAfter = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whA.warehouseId}&date=${today}`, vendorToken);
    const tripleAfter = availAfter.data.docks.find((d: any) => d.dockId === dockTriple).slots[1];
    check(tripleAfter.remainingCapacity === 0 && !tripleAfter.available, 'availability agrees: capacity-3 slot now full', tripleAfter);

    const usedTransactions = !logs.join('').includes('MongoDB transactions are unavailable');
    check(usedTransactions, 'bookings ran inside MongoDB transactions (no standalone fallback)');

    // ------------------------------------------------------------------
    console.log('\nBooking status lifecycle');
    const mine = await call(A, 'GET', '/api/bookings', vendorToken);
    const singleBooking = mine.data.bookings.find((b: any) => b.dockId._id === dockSingle);
    const [t1, t2] = mine.data.bookings.filter((b: any) => b.dockId._id === dockTriple);
    const setStatus = (id: string, status: string, token = whA.token) =>
      call(B, 'PATCH', `/api/bookings/${id}/status`, token, { status });

    check((await setStatus(singleBooking._id, 'APPROVED')).status === 200, 'PENDING -> APPROVED');
    check((await setStatus(singleBooking._id, 'IN_PROGRESS')).status === 200, 'APPROVED -> IN_PROGRESS');
    const vendorCancelInProgress = await setStatus(singleBooking._id, 'CANCELLED', vendorToken);
    check(vendorCancelInProgress.status === 400, 'vendor cannot cancel a booking already at the dock', vendorCancelInProgress.status);
    check((await setStatus(singleBooking._id, 'COMPLETED')).status === 200, 'IN_PROGRESS -> COMPLETED');
    const revive = await setStatus(singleBooking._id, 'PENDING');
    check(revive.status === 400, 'COMPLETED -> PENDING is rejected', revive.status);

    check((await setStatus(t1._id, 'CANCELLED', vendorToken)).status === 200, 'vendor cancels a PENDING booking (frees a place)');
    const reviveCancelled = await setStatus(t1._id, 'APPROVED');
    check(reviveCancelled.status === 400, 'CANCELLED booking cannot be re-approved', reviveCancelled.status);

    const rebook = await book(A, dockTriple, slot3.startTime, slot3.endTime, 99);
    check(rebook.status === 201, 'freed place can be booked again', rebook.status);
    const overfull = await book(B, dockTriple, slot3.startTime, slot3.endTime, 100);
    check(overfull.status === 409, '...and the slot is full again afterwards', overfull.status);

    const crossTenant = await setStatus(t2._id, 'APPROVED', whB.token);
    check(crossTenant.status === 403, "warehouse B's admin cannot change warehouse A's booking", crossTenant.status);

    // ------------------------------------------------------------------
    console.log('\n5. Scheduling rules, dock types, maintenance, blackouts (warehouse B, UTC)');
    const approveAtB = await call(A, 'PATCH', `/api/vendors/${vendorId}/status`, whB.token, { status: 'APPROVED' });
    check(approveAtB.status === 200, 'warehouse B approves the carrier');

    const settings = await call(A, 'PUT', '/api/warehouses/settings', whB.token, { slotDurationMinutes: 30, bufferMinutes: 15 });
    check(settings.status === 200, 'admin sets 30-min slots with 15-min buffer');
    const badSettings = await call(A, 'PUT', '/api/warehouses/settings', whB.token, { slotDurationMinutes: 45 });
    check(badSettings.status === 400, 'unsupported slot length (45) is rejected');

    const reeferDock = (await call(A, 'POST', '/api/docks', whB.token, { dockName: 'R1', direction: 'INBOUND', supportedTrailerTypes: ['REEFER'], maxCapacityPerHour: 1 })).data.dock._id;
    const dryDock = (await call(A, 'POST', '/api/docks', whB.token, { dockName: 'D1', direction: 'BOTH', supportedTrailerTypes: ['DRY_VAN'], maxCapacityPerHour: 1 })).data.dock._id;

    const dayB = today; // B is UTC, Mon–Fri 08:00–17:00
    const at = (hhmm: string, date = dayB) => new Date(`${date}T${hhmm}:00.000Z`).toISOString();
    const availReefer = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whB.warehouseId}&date=${dayB}&trailerType=REEFER&direction=INBOUND`, vendorToken);
    const reeferSlots = availReefer.data.docks?.[0]?.slots ?? [];
    check(
      availReefer.data.docks?.length === 1 && availReefer.data.docks[0].dockId === reeferDock,
      'reefer load only sees the reefer dock (type matching)',
      availReefer.data.docks?.map((d: any) => d.dockName)
    );
    check(
      reeferSlots[0]?.localTime === '08:00 - 08:30' && reeferSlots[1]?.localTime === '08:45 - 09:15',
      'slot grid follows 30-min slots + 15-min buffer',
      reeferSlots.slice(0, 2).map((s: any) => s.localTime)
    );

    const bookB = (dockId: string, start: string, end: string, extra: Record<string, unknown> = {}, token = vendorToken, port = A) =>
      call(port, 'POST', '/api/bookings', token, {
        warehouseId: whB.warehouseId, dockId, truckNumber: 'TRK-B', driverName: 'Driver B', driverPhone: '555-0199',
        startTime: start, endTime: end, direction: 'INBOUND', trailerType: 'REEFER', ...extra,
      });

    const wrongType = await bookB(reeferDock, at('08:00'), at('08:30'), { trailerType: 'DRY_VAN' });
    check(wrongType.status === 400, 'dry-van truck cannot book the reefer-only dock', wrongType.data.error);

    const maint = await call(A, 'POST', `/api/docks/${dryDock}/maintenance`, whB.token, { startTime: at('08:45'), endTime: at('09:15'), reason: 'Leveller repair' });
    check(maint.status === 201, 'maintenance window scheduled');
    const availDry = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whB.warehouseId}&date=${dayB}&trailerType=DRY_VAN`, vendorToken);
    check(availDry.data.docks[0].slots[1].reason === 'MAINTENANCE', 'maintenance blocks the overlapping slot');
    const duringMaint = await bookB(dryDock, at('08:45'), at('09:15'), { trailerType: 'DRY_VAN' });
    check(duringMaint.status === 400, 'booking during maintenance is rejected');

    const nextDay = (() => {
      let d = new Date(`${dayB}T00:00:00Z`);
      do { d = new Date(d.getTime() + 86400000); } while ([0, 6].includes(d.getUTCDay()));
      return d.toISOString().slice(0, 10);
    })();
    const blackout = await call(A, 'POST', '/api/warehouses/blackouts', whB.token, { date: nextDay, reason: 'Public holiday' });
    check(blackout.status === 201, 'blackout date added');
    const closedDay = await call(A, 'GET', `/api/bookings/availability?warehouseId=${whB.warehouseId}&date=${nextDay}`, vendorToken);
    check(closedDay.data.closed && closedDay.data.message.includes('Public holiday'), 'blackout date is closed with its reason');
    const onHoliday = await bookB(reeferDock, at('08:00', nextDay), at('08:30', nextDay));
    check(onHoliday.status === 400, 'booking on a blackout date is rejected');

    // ------------------------------------------------------------------
    console.log('\n6. Recurring series, waitlist auto-assignment, rescheduling');
    const series = await bookB(reeferDock, at('08:00'), at('08:30'), { recurrence: { weeks: 3 }, referenceNumber: 'PO-1', palletCount: 20 });
    check(series.status === 201 && series.data.bookings.length === 3, 'weekly recurring series creates 3 appointments', series.data);
    const seriesIds: string[] = (series.data.bookings ?? []).map((b: any) => b._id);

    const v2reg = await call(A, 'POST', '/api/auth/register', undefined, {
      username: 'carrier2', email: 'carrier2@example.com', password: 'password123', role: 'VENDOR', vendorCompany: 'Second Carrier', warehouseIds: [whB.warehouseId],
    });
    await call(A, 'PATCH', `/api/vendors/${v2reg.data.user._id}/status`, whB.token, { status: 'APPROVED' });
    const v2token = (await call(A, 'POST', '/api/auth/login', undefined, { email: 'carrier2@example.com', password: 'password123' })).data.token;

    const v2full = await bookB(reeferDock, at('08:00'), at('08:30'), {}, v2token, B);
    check(v2full.status === 409, 'second carrier finds the reefer slot full');
    const join = await call(B, 'POST', '/api/waitlist', v2token, {
      warehouseId: whB.warehouseId, dockId: reeferDock, startTime: at('08:00'), endTime: at('08:30'),
      trailerType: 'REEFER', direction: 'INBOUND', truckNumber: 'WAIT-1', driverName: 'Waiting Driver', driverPhone: '555-0777',
    });
    check(join.status === 201 && join.data.position === 1, 'second carrier joins the waitlist (position 1)', join.data);
    const joinFree = await call(B, 'POST', '/api/waitlist', v2token, {
      warehouseId: whB.warehouseId, dockId: reeferDock, startTime: at('09:30'), endTime: at('10:00'),
      trailerType: 'REEFER', direction: 'INBOUND', truckNumber: 'WAIT-2', driverName: 'X', driverPhone: '555-0778',
    });
    check(joinFree.status === 409, 'cannot waitlist a slot that still has space');

    const cancelFirst = await call(A, 'PATCH', `/api/bookings/${seriesIds[0]}/status`, vendorToken, { status: 'CANCELLED' });
    check(cancelFirst.status === 200, 'first carrier cancels the first appointment of the series');
    const v2bookings = (await call(B, 'GET', '/api/bookings', v2token)).data.bookings;
    const assigned = v2bookings.find((b: any) => b.truckNumber === 'WAIT-1');
    check(!!assigned && assigned.status === 'PENDING', 'freed slot auto-assigned to the waitlisted carrier', v2bookings);
    const v2wait = (await call(B, 'GET', '/api/waitlist', v2token)).data.entries;
    check(v2wait[0]?.status === 'FULFILLED', 'waitlist entry marked FULFILLED');
    const v2notes = (await call(B, 'GET', '/api/notifications', v2token)).data.notifications;
    check(v2notes.some((n: any) => n.type === 'WAITLIST_ASSIGNED'), 'carrier notified about the auto-assignment');

    const resched = await call(B, 'PATCH', `/api/bookings/${assigned._id}/reschedule`, v2token, { startTime: at('09:30'), endTime: at('10:00') });
    check(resched.status === 200 && resched.data.booking.rescheduleHistory.length === 1, 'carrier reschedules to 09:30 (history kept)', resched.data);
    const reschedFull = await call(A, 'PATCH', `/api/bookings/${seriesIds[1]}/reschedule`, vendorToken, { startTime: at('09:30'), endTime: at('10:00') });
    check(reschedFull.status === 409, 'rescheduling into a full slot is refused');

    // ------------------------------------------------------------------
    console.log('\n7. Gate check-in, arrival tracking, reliability, audit, analytics');
    await call(A, 'PATCH', `/api/bookings/${assigned._id}/status`, whB.token, { status: 'APPROVED' });
    const early = await call(A, 'PATCH', `/api/bookings/${assigned._id}/status`, whB.token, { status: 'NO_SHOW' });
    check(early.status === 400, 'cannot mark no-show before the slot starts');
    const checkin = await call(A, 'PATCH', `/api/bookings/${assigned._id}/status`, whB.token, { status: 'CHECKED_IN' });
    check(checkin.data.booking?.arrivalStatus === 'ON_TIME' && !!checkin.data.booking?.checkedInAt, 'gate check-in records time + on-time arrival', checkin.data);
    await call(B, 'PATCH', `/api/bookings/${assigned._id}/status`, whB.token, { status: 'IN_PROGRESS' });
    const done = await call(A, 'PATCH', `/api/bookings/${assigned._id}/status`, whB.token, { status: 'COMPLETED' });
    check(!!done.data.booking?.dockStartedAt && !!done.data.booking?.completedAt, 'dock start and completion timestamps recorded');
    const score = (await call(A, 'GET', '/api/vendors/me/score', v2token)).data.score;
    check(score?.reliabilityScore === 100 && score?.tier === 'A', 'reliability score computed (100, tier A)', score);

    const seriesCancel = await call(A, 'PATCH', `/api/bookings/series/${series.data.recurrenceGroupId}/cancel`, vendorToken);
    check(seriesCancel.data.cancelled === 2, 'remaining 2 appointments of the series cancelled together', seriesCancel.data);

    const auditB = (await call(A, 'GET', '/api/audit-logs?limit=200', whB.token)).data;
    const actions = new Set((auditB.logs ?? []).map((l: any) => l.action));
    const expected = ['WAITLIST_AUTO_ASSIGNED', 'BOOKING_RESCHEDULED', 'BLACKOUT_ADDED', 'MAINTENANCE_SCHEDULED', 'SCHEDULING_SETTINGS_UPDATED', 'RECURRING_BOOKING_CREATED', 'BOOKING_STATUS_CHANGED'];
    check(expected.every((a) => actions.has(a)), 'audit log records every action type', [...actions]);
    const logsA = (await call(A, 'GET', '/api/audit-logs?limit=200', whA.token)).data.logs;
    check(!logsA.some((l: any) => l.action === 'BLACKOUT_ADDED'), "warehouse A's admin cannot see warehouse B's audit log");

    const analytics = await call(A, 'GET', `/api/analytics?from=${dayB}&to=${dayB}`, whB.token);
    check(
      analytics.status === 200 && analytics.data.kpis.totalAppointments >= 1 && analytics.data.perDock.length === 2 && analytics.data.heatmap.length === 7,
      'analytics returns KPIs, per-dock utilization and heatmap',
      analytics.data.kpis
    );
  } finally {
    servers.forEach((s) => s.kill());
    await replSet.stop();
  }

  console.log(failures === 0 ? '\n\x1b[32mAll checks passed.\x1b[0m' : `\n\x1b[31m${failures} check(s) failed.\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
