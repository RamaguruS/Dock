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
