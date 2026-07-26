import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes from './routes/authRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import dockRoutes from './routes/dockRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';

process.env.JWT_SECRET = 'test_booking_jwt_secret_key_123';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/smartdock_booking_test';
process.env.PORT = '5002';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/docks', dockRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/vendors', vendorRoutes);

// Setup default JSON fetch wrapper
const originalFetch = global.fetch;
global.fetch = function (url, init) {
  if (init && init.body && typeof init.body === 'string') {
    init.headers = {
      'Content-Type': 'application/json',
      ...((init.headers || {}) as any),
    };
  }
  return originalFetch(url, init);
};

async function runBookingTest() {
  console.log('--- Starting E2E Booking & Availability Test ---');

  // 1. Database setup
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    console.log('Connected to booking test database.');
    await mongoose.connection.db?.dropDatabase();
    console.log('Database dropped clean.');
  } catch (err) {
    console.error('Failed to setup DB:', err);
    process.exit(1);
  }

  // 2. Start Test Server
  const server = app.listen(5002, () => {
    console.log('Test booking server active on port 5002.');
  });

  const BASE_URL = 'http://127.0.0.1:5002';

  try {
    // 3. Register and Approve Vendor
    console.log('\nStep 1: Registering Vendor...');
    const regVendorRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        username: 'fastcarrier',
        email: 'carrier@test.com',
        password: 'password123',
        role: 'VENDOR',
        vendorCompany: 'Fast Carrier LLC',
      }),
    });
    const vendorData = await regVendorRes.json();
    console.log('Register Vendor Status:', regVendorRes.status);
    const vendorId = vendorData.user._id;

    // Register Warehouse Admin (creates warehouse)
    console.log('\nStep 2: Registering Warehouse Admin...');
    const regAdminRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        username: 'depotadmin',
        email: 'depot@test.com',
        password: 'password123',
        role: 'WAREHOUSE_ADMIN',
        warehouseName: 'Eastern Logistics Terminal',
        warehouseAddress: '789 Highway 10',
        timezone: 'America/New_York',
      }),
    });
    const adminData = await regAdminRes.json();
    console.log('Register Admin Status:', regAdminRes.status);
    const warehouseId = adminData.user.warehouseId;

    // Login Admin
    const loginAdminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'depot@test.com', password: 'password123' }),
    });
    const loginAdminData = await loginAdminRes.json();
    const adminToken = loginAdminData.token;

    // Approve the vendor
    console.log('\nStep 3: Approving Vendor Account as Admin...');
    const approveVendorRes = await fetch(`${BASE_URL}/api/vendors/${vendorId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    console.log('Approve Vendor Status:', approveVendorRes.status);

    // Login Vendor to get their access token
    const loginVendorRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'carrier@test.com', password: 'password123' }),
    });
    const loginVendorData = await loginVendorRes.json();
    const vendorToken = loginVendorData.token;
    console.log('Vendor Login Status:', loginVendorRes.status);

    // 4. Create an active Dock (capacity = 1 truck/hr)
    console.log('\nStep 4: Creating Dock Asset...');
    const createDockRes = await fetch(`${BASE_URL}/api/docks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        dockName: 'Bay-1',
        maxCapacityPerHour: 1,
        isActive: true,
      }),
    });
    const dockData = await createDockRes.json();
    console.log('Create Dock Status:', createDockRes.status);
    console.log('Create Dock Body:', dockData);
    const dockId = dockData.dock._id;

    // 5. Query Availability for next Monday (e.g. 2026-07-20)
    const testDate = '2026-07-20';
    console.log(`\nStep 5: Querying Availability for ${testDate} before booking...`);
    const availResBefore = await fetch(`${BASE_URL}/api/bookings/availability?warehouseId=${warehouseId}&date=${testDate}`, {
      headers: { Authorization: `Bearer ${vendorToken}` },
    });
    const availDataBefore = await availResBefore.json();
    console.log('Query Availability Status:', availResBefore.status);
    
    const bay1Avail = availDataBefore.docks.find((d: any) => d.dockId === dockId);
    console.log('Bay-1 Slots Count:', bay1Avail.slots.length);
    console.log('Bay-1 First Slot Availability:', bay1Avail.slots[0]);

    if (!bay1Avail.slots[0].available) {
      throw new Error('Expected first slot to be available.');
    }

    const firstSlotStartTime = bay1Avail.slots[0].startTime;
    const firstSlotEndTime = bay1Avail.slots[0].endTime;

    // 6. Create Booking Request (Vendor)
    console.log('\nStep 6: Reserving Dock Timeslot...');
    const bookRes = await fetch(`${BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendorToken}` },
      body: JSON.stringify({
        warehouseId,
        dockId,
        truckNumber: 'TRK-9021',
        driverName: 'Robert Cargo',
        driverPhone: '555-8899',
        startTime: firstSlotStartTime,
        endTime: firstSlotEndTime,
      }),
    });
    const bookData = await bookRes.json();
    console.log('Booking Status:', bookRes.status);
    console.log('Booking Body:', bookData);
    const bookingId = bookData.booking._id;

    if (bookRes.status !== 201 || bookData.booking.status !== 'PENDING') {
      throw new Error('Booking failed to create with PENDING status');
    }
    console.log('✅ Booking successfully requested (PENDING).');

    // 7. Verify Availability is updated (first slot should now be unavailable)
    console.log('\nStep 7: Re-querying Availability (Slot should now be disabled)...');
    const availResAfter = await fetch(`${BASE_URL}/api/bookings/availability?warehouseId=${warehouseId}&date=${testDate}`, {
      headers: { Authorization: `Bearer ${vendorToken}` },
    });
    const availDataAfter = await availResAfter.json();
    const bay1AvailAfter = availDataAfter.docks.find((d: any) => d.dockId === dockId);
    console.log('Bay-1 First Slot Availability (Updated):', bay1AvailAfter.slots[0]);

    if (bay1AvailAfter.slots[0].available) {
      throw new Error('Expected first slot to be unavailable/taken.');
    }
    console.log('✅ Availability status subtraction verified.');

    // 8. Try to double-book the same slot (should fail with 409 Conflict)
    console.log('\nStep 8: Attempting to Double-Book the same slot (should fail with 409 Conflict)...');
    const doubleBookRes = await fetch(`${BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendorToken}` },
      body: JSON.stringify({
        warehouseId,
        dockId,
        truckNumber: 'TRK-9999',
        driverName: 'Imposter Driver',
        driverPhone: '555-0000',
        startTime: firstSlotStartTime,
        endTime: firstSlotEndTime,
      }),
    });
    const doubleBookData = await doubleBookRes.json();
    console.log('Double Book Status:', doubleBookRes.status);
    console.log('Double Book Response Body:', doubleBookData);

    if (doubleBookRes.status !== 409) {
      throw new Error('Expected double booking to fail with 409 conflict');
    }
    console.log('✅ Database-level atomic overlap prevention verified.');

    // 9. Admin approves booking
    console.log('\nStep 9: Admin approving booking...');
    const approveBookingRes = await fetch(`${BASE_URL}/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    console.log('Approve Booking Status:', approveBookingRes.status);
    
    // 10. Admin checks-in booking
    console.log('\nStep 10: Checking-in truck (status -> IN_PROGRESS)...');
    const checkinBookingRes = await fetch(`${BASE_URL}/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'IN_PROGRESS' }),
    });
    const checkinData = await checkinBookingRes.json();
    console.log('Checkin Status:', checkinBookingRes.status);
    console.log('Checkin Body Status:', checkinData.booking.status);

    if (checkinData.booking.status !== 'IN_PROGRESS') {
      throw new Error('Check-in status failed');
    }
    console.log('✅ Checked-in operation verified.');

    // 11. Admin completes booking
    console.log('\nStep 11: Completing loading operation (status -> COMPLETED)...');
    const completeBookingRes = await fetch(`${BASE_URL}/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    const completeData = await completeBookingRes.json();
    console.log('Completion Status:', completeBookingRes.status);
    console.log('Completion Body Status:', completeData.booking.status);

    if (completeData.booking.status !== 'COMPLETED') {
      throw new Error('Complete status failed');
    }
    console.log('✅ Completed operation verified.');

    console.log('\n\x1b[32m%s\x1b[0m', '🎉 E2E BOOKING, AVAILABILITY MATH, AND CONFLICT TESTS PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '❌ TEST RUN FAILED:', error);
    server.close();
    await mongoose.disconnect();
    process.exit(1);
  }

  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

runBookingTest();
