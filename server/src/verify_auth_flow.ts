import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/authRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import dockRoutes from './routes/dockRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';

// Setup environment variables for testing
process.env.JWT_SECRET = 'test_jwt_secret_key_123';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/smartdock_test';
process.env.PORT = '5001';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/docks', dockRoutes);
app.use('/api/vendors', vendorRoutes);

async function runVerification() {
  console.log('--- Starting Integration Test ---');

  // 1. Connect to local Test MongoDB
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    console.log('Connected to test database.');

    // Clean test database collections
    await mongoose.connection.db?.dropDatabase();
    console.log('Test database cleared.');
  } catch (err) {
    console.error('Failed to connect or clear test DB:', err);
    process.exit(1);
  }

  // 2. Start Server
  const server = app.listen(5001, () => {
    console.log('Test server started on port 5001.');
  });

  const BASE_URL = 'http://127.0.0.1:5001';

  try {
    // 3. Register a Vendor
    console.log('\nStep 1: Registering a Vendor...');
    const registerVendorRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({
        username: 'testvendor',
        email: 'vendor@test.com',
        password: 'password123',
        role: 'VENDOR',
        vendorCompany: 'Fast Cargo Inc',
      }),
    });
    const vendorData = await registerVendorRes.json();
    console.log('Register Vendor Response Status:', registerVendorRes.status);
    console.log('Register Vendor Response Body:', vendorData);

    if (registerVendorRes.status !== 201 || vendorData.user.status !== 'PENDING') {
      throw new Error('Vendor registration failed or status is not PENDING');
    }
    console.log('✅ Vendor registration verified.');

    // 4. Try to Login as Vendor (should fail with 403 pending status)
    console.log('\nStep 2: Attempting to Login as Pending Vendor (should fail)...');
    const loginVendorRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'vendor@test.com',
        password: 'password123',
      }),
    });
    const loginVendorData = await loginVendorRes.json();
    console.log('Login Pending Vendor Response Status:', loginVendorRes.status);
    console.log('Login Pending Vendor Response Body:', loginVendorData);

    if (loginVendorRes.status !== 403 || !loginVendorData.error.toLowerCase().includes('pending')) {
      throw new Error('Expected 403 Forbidden with pending status error message');
    }
    console.log('✅ Pending vendor login block verified.');

    // 5. Register a Warehouse Admin
    console.log('\nStep 3: Registering a Warehouse Admin...');
    const registerAdminRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testadmin',
        email: 'admin@test.com',
        password: 'password123',
        role: 'WAREHOUSE_ADMIN',
        warehouseName: 'Main Depot',
        warehouseAddress: '456 Hub Way',
        timezone: 'UTC',
      }),
    });
    const adminData = await registerAdminRes.json();
    console.log('Register Admin Response Status:', registerAdminRes.status);
    console.log('Register Admin Response Body:', adminData);

    if (registerAdminRes.status !== 201 || !adminData.warehouse._id) {
      throw new Error('Warehouse Admin registration failed');
    }
    console.log('✅ Warehouse Admin registration verified.');

    // 6. Login as Warehouse Admin (should succeed)
    console.log('\nStep 4: Logging in as Warehouse Admin...');
    const loginAdminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@test.com',
        password: 'password123',
      }),
    });
    const loginAdminData = await loginAdminRes.json();
    console.log('Login Admin Response Status:', loginAdminRes.status);
    const adminToken = loginAdminData.token;

    if (loginAdminRes.status !== 200 || !adminToken) {
      throw new Error('Admin login failed');
    }
    console.log('✅ Admin login verified.');

    // 7. Get Pending Vendors list as Admin (should return the registered vendor)
    console.log('\nStep 5: Fetching Pending Vendors as Admin...');
    const getPendingRes = await fetch(`${BASE_URL}/api/vendors/pending`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const pendingData = await getPendingRes.json();
    console.log('Get Pending Vendors Response Status:', getPendingRes.status);
    console.log('Get Pending Vendors:', pendingData.vendors);

    const targetVendor = pendingData.vendors.find((v: any) => v.email === 'vendor@test.com');
    if (!targetVendor) {
      throw new Error('Registered vendor not found in pending list');
    }
    console.log('✅ Pending list retrieval verified.');

    // 8. Approve Vendor
    console.log('\nStep 6: Approving Vendor as Admin...');
    const approveRes = await fetch(`${BASE_URL}/api/vendors/${targetVendor._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    const approveData = await approveRes.json();
    console.log('Approve Vendor Response Status:', approveRes.status);
    console.log('Approve Vendor Response Body:', approveData);

    if (approveRes.status !== 200 || approveData.vendor.status !== 'APPROVED') {
      throw new Error('Vendor approval failed');
    }
    console.log('✅ Vendor approval verified.');

    // 9. Login as Vendor again (should now succeed)
    console.log('\nStep 7: Logging in as Approved Vendor (should succeed)...');
    const loginVendorApproveRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'vendor@test.com',
        password: 'password123',
      }),
    });
    const loginVendorApproveData = await loginVendorApproveRes.json();
    console.log('Login Approved Vendor Response Status:', loginVendorApproveRes.status);
    console.log('Login Approved Vendor Response Body:', loginVendorApproveData);

    if (loginVendorApproveRes.status !== 200 || !loginVendorApproveData.token) {
      throw new Error('Approved vendor login failed');
    }
    console.log('✅ Approved vendor login verified.');

    console.log('\n\x1b[32m%s\x1b[0m', '🎉 ALL AUTH AND GUARD FLOW TESTS PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '❌ TEST RUN FAILED:', error);
    server.close();
    await mongoose.disconnect();
    process.exit(1);
  }

  // Cleanup
  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

// Set JSON headers content type dynamically in our requests
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

runVerification();
