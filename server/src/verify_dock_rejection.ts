import { Request, Response } from 'express';
import { updateDock } from './controllers/dockController.js';
import { Dock } from './models/Dock.js';
import mongoose from 'mongoose';

// Create a mock dock that belongs to warehouse "warehouse_other"
const otherWarehouseId = new mongoose.Types.ObjectId();
const mockDock = {
  _id: new mongoose.Types.ObjectId(),
  warehouseId: otherWarehouseId,
  dockName: 'Dock A',
  maxCapacityPerHour: 1,
  isActive: true,
};

// Mock Dock.findById to return the mockDock without hitting a real database
Dock.findById = (async (id: any) => {
  return mockDock as any;
}) as any;

async function runTest() {
  console.log('--- Running Tenant Isolation Verification Test ---');

  // Request representing an admin from a DIFFERENT warehouse attempting to modify mockDock
  const req = {
    user: {
      userId: new mongoose.Types.ObjectId().toString(),
      role: 'WAREHOUSE_ADMIN',
      warehouseId: new mongoose.Types.ObjectId().toString(), // My warehouse (different from otherWarehouseId)
    },
    params: {
      id: mockDock._id.toString(),
    },
    body: {
      dockName: 'Unauthorized Dock Name Change',
    },
  } as unknown as Request;

  let statusCode = 0;
  let responseBody: any = null;

  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: any) => {
      responseBody = body;
      return res;
    },
  } as unknown as Response;

  try {
    await updateDock(req, res);
    console.log('HTTP Status Code returned:', statusCode);
    console.log('Response JSON returned:', responseBody);

    if (statusCode === 403 && responseBody?.error?.includes('Forbidden')) {
      console.log('\x1b[32m%s\x1b[0m', '✅ TEST PASSED: Access rejected successfully with 403 Forbidden!');
      process.exit(0);
    } else {
      console.log('\x1b[31m%s\x1b[0m', '❌ TEST FAILED: Request was not rejected with 403 Forbidden.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test threw an error:', err);
    process.exit(1);
  }
}

runTest();
