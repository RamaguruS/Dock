import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Warehouse } from '../models/Warehouse.js';
import { VendorAccess } from '../models/VendorAccess.js';
import { logger } from '../config/logger.js';

const objectIdString = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid ID');

/**
 * Resolve which warehouse an admin is acting on.
 * Warehouse admins are always pinned to the warehouse in their JWT; super admins must name one.
 */
const resolveAdminWarehouse = (req: Request, explicit?: unknown): string | null => {
  if (req.user?.role === 'WAREHOUSE_ADMIN') return req.user.warehouseId ?? null;
  if (req.user?.role === 'SUPER_ADMIN' && typeof explicit === 'string' && Types.ObjectId.isValid(explicit)) {
    return explicit;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

/** Pending access requests for the admin's own warehouse (super admins: optionally filter by ?warehouseId). */
export const getPendingVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: Record<string, unknown> = { status: 'PENDING' };

    if (req.user?.role === 'WAREHOUSE_ADMIN') {
      if (!req.user.warehouseId) {
        res.status(400).json({ error: 'No warehouse associated with this account' });
        return;
      }
      filter.warehouseId = req.user.warehouseId;
    } else if (req.query.warehouseId) {
      const warehouseId = resolveAdminWarehouse(req, req.query.warehouseId);
      if (!warehouseId) {
        res.status(400).json({ error: 'Invalid warehouseId' });
        return;
      }
      filter.warehouseId = warehouseId;
    }

    const requests = await VendorAccess.find(filter)
      .populate('vendorId', 'username email vendorCompany status createdAt')
      .populate('warehouseId', 'name')
      .sort({ createdAt: 1 });

    // Keep the response shape the dashboard already uses: a list of vendor users,
    // enriched with the access request they belong to.
    const vendors = requests
      .filter((r) => r.vendorId) // skip requests whose vendor was deleted
      .map((r) => {
        const vendor = r.vendorId as any;
        const warehouse = r.warehouseId as any;
        return {
          _id: vendor._id,
          username: vendor.username,
          email: vendor.email,
          vendorCompany: vendor.vendorCompany,
          createdAt: vendor.createdAt,
          accessId: r._id,
          warehouseId: warehouse?._id,
          warehouseName: warehouse?.name,
          requestedAt: r.createdAt,
        };
      });

    res.status(200).json({ vendors });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

const vendorStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  warehouseId: objectIdString.optional(), // required for SUPER_ADMIN only
});

/** Approve / reject (or later revoke) a vendor's access to the admin's own warehouse. */
export const updateVendorStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid vendor ID' });
      return;
    }

    const parsed = vendorStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const warehouseId = resolveAdminWarehouse(req, parsed.data.warehouseId);
    if (!warehouseId) {
      res.status(400).json({ error: 'A warehouse is required (super admins must pass warehouseId)' });
      return;
    }

    const vendor = await User.findOne({ _id: id, role: 'VENDOR' });
    if (!vendor) {
      res.status(404).json({ error: 'Vendor not found' });
      return;
    }

    // Only an existing request for THIS warehouse can be decided — admins cannot touch
    // a vendor's standing at other warehouses.
    const access = await VendorAccess.findOneAndUpdate(
      { vendorId: vendor._id, warehouseId },
      { $set: { status: parsed.data.status, decidedBy: req.user?.userId, decidedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!access) {
      res.status(404).json({ error: 'This vendor has not requested access to your warehouse' });
      return;
    }

    logger.info(`[AUDIT] Vendor access updated: Vendor ${vendor._id} (${vendor.email}), Warehouse ${warehouseId}, Status ${parsed.data.status}, Action by: ${req.user?.userId} (${req.user?.role})`);

    res.status(200).json({
      message: `Vendor access has been ${parsed.data.status.toLowerCase()}`,
      vendor,
      access,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

// ---------------------------------------------------------------------------
// Vendor self-service endpoints
// ---------------------------------------------------------------------------

/** The calling vendor's access records, with warehouse details. */
export const getMyAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    const access = await VendorAccess.find({ vendorId: req.user?.userId })
      .populate('warehouseId', 'name address timezone')
      .sort({ createdAt: 1 });

    res.status(200).json({ access: access.filter((a) => a.warehouseId) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

const requestAccessSchema = z.object({
  warehouseId: objectIdString,
});

/** Ask an additional warehouse for booking access. */
export const requestAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = requestAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { warehouseId } = parsed.data;
    const warehouse = await Warehouse.exists({ _id: warehouseId });
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    const existing = await VendorAccess.findOne({ vendorId: req.user?.userId, warehouseId });
    if (existing) {
      res.status(409).json({ error: `You already have a ${existing.status.toLowerCase()} request for this warehouse` });
      return;
    }

    const access = await VendorAccess.create({ vendorId: req.user?.userId, warehouseId, status: 'PENDING' });
    await access.populate('warehouseId', 'name address timezone');

    logger.info(`[AUDIT] Vendor access requested: Vendor ${req.user?.userId}, Warehouse ${warehouseId}`);

    res.status(201).json({ message: 'Access requested', access });
  } catch (error: any) {
    if (error?.code === 11000) {
      res.status(409).json({ error: 'You already have a request for this warehouse' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};
