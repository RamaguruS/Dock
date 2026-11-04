/**
 * One-off migration from the old global vendor approval to per-warehouse access.
 *
 * Old model: User.status on a vendor = PENDING | APPROVED | REJECTED, valid for every warehouse.
 * New model: User.status = account status; VendorAccess records grant booking rights per warehouse.
 *
 * What it does (idempotent — safe to run more than once):
 * - Previously APPROVED vendors keep what they had: an APPROVED access record for every warehouse
 *   they already have bookings at. Pass --grant-all to approve them at every warehouse instead
 *   (matches the old behaviour exactly, where approval worked everywhere).
 * - Previously PENDING vendors become active accounts with no access yet; they request warehouses from their dashboard.
 * - Previously REJECTED vendors stay REJECTED (cannot log in).
 *
 * Usage: npm run migrate:vendor-access [-- --grant-all] [-- --dry-run]
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Warehouse } from '../models/Warehouse.js';
import { Booking } from '../models/Booking.js';
import { VendorAccess } from '../models/VendorAccess.js';

dotenv.config();

const grantAll = process.argv.includes('--grant-all');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI);

  const allWarehouseIds = (await Warehouse.find().select('_id')).map((w) => w._id.toString());
  let accessCreated = 0;

  const approvedVendors = await User.find({ role: 'VENDOR', status: 'APPROVED' });
  for (const vendor of approvedVendors) {
    const warehouseIds = grantAll
      ? allWarehouseIds
      : (await Booking.distinct('warehouseId', { vendorId: vendor._id })).map(String);

    for (const warehouseId of warehouseIds) {
      if (dryRun) {
        accessCreated++;
        continue;
      }
      const result = await VendorAccess.updateOne(
        { vendorId: vendor._id, warehouseId },
        { $setOnInsert: { status: 'APPROVED', decidedAt: new Date() } },
        { upsert: true }
      );
      accessCreated += result.upsertedCount;
    }
  }

  const pendingFilter = { role: 'VENDOR', status: 'PENDING' };
  const pendingCount = await User.countDocuments(pendingFilter);
  if (!dryRun) await User.updateMany(pendingFilter, { $set: { status: 'APPROVED' } });

  console.log(`${dryRun ? '[dry run] ' : ''}Approved vendors processed: ${approvedVendors.length}`);
  console.log(`${dryRun ? '[dry run] ' : ''}Access records created: ${accessCreated}${grantAll ? ' (all warehouses)' : ' (warehouses with existing bookings)'}`);
  console.log(`${dryRun ? '[dry run] ' : ''}Pending vendors activated (no warehouse access yet): ${pendingCount}`);
}

main()
  .catch((err) => {
    console.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
