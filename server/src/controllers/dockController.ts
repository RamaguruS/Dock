import { Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Dock } from '../models/Dock.js';
import { hasApprovedAccess } from '../models/VendorAccess.js';

const createDockSchema = z.object({
  dockName: z.string().min(1, 'Dock name is required'),
  maxCapacityPerHour: z.number().min(1, 'Capacity must be at least 1').optional(),
  isActive: z.boolean().optional(),
});

const updateDockSchema = z.object({
  dockName: z.string().min(1).optional(),
  maxCapacityPerHour: z.number().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const createDock = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouseId = req.user?.warehouseId;
    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse associated with this account' });
      return;
    }

    const parsed = createDockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { dockName, maxCapacityPerHour, isActive } = parsed.data;

    // Check if a dock with this name already exists in this warehouse
    const existingDock = await Dock.findOne({ warehouseId, dockName });
    if (existingDock) {
      res.status(400).json({ error: `A dock named "${dockName}" already exists in this warehouse` });
      return;
    }

    const newDock = new Dock({
      warehouseId,
      dockName,
      maxCapacityPerHour: maxCapacityPerHour ?? 1,
      isActive: isActive ?? true,
    });

    await newDock.save();

    res.status(201).json({
      message: 'Dock created successfully',
      dock: newDock,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getDocks = async (req: Request, res: Response): Promise<void> => {
  try {
    // If it's a Warehouse Admin, force-filter by their own warehouseId
    // If it's Super Admin or Vendor, allow getting by query param 'warehouseId'
    let warehouseId: string | undefined;

    if (req.user?.role === 'WAREHOUSE_ADMIN') {
      warehouseId = req.user.warehouseId;
    } else {
      warehouseId = req.query.warehouseId as string;
    }

    if (!warehouseId || !Types.ObjectId.isValid(warehouseId)) {
      res.status(400).json({ error: 'A valid warehouseId query parameter or warehouse association is required' });
      return;
    }

    // Vendors only see docks of warehouses that approved them
    if (req.user?.role === 'VENDOR' && !(await hasApprovedAccess(req.user.userId, warehouseId))) {
      res.status(403).json({ error: 'Forbidden: You are not approved to book at this warehouse' });
      return;
    }

    const docks = await Dock.find({ warehouseId });
    res.status(200).json({ docks });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const updateDock = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse associated with this account' });
      return;
    }

    const parsed = updateDockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const dock = await Dock.findById(id);
    if (!dock) {
      res.status(404).json({ error: 'Dock not found' });
      return;
    }

    // Tenant Isolation Check
    if (dock.warehouseId.toString() !== warehouseId) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to manage this dock' });
      return;
    }

    // If changing name, ensure uniqueness
    if (parsed.data.dockName && parsed.data.dockName !== dock.dockName) {
      const existingDock = await Dock.findOne({ warehouseId, dockName: parsed.data.dockName });
      if (existingDock) {
        res.status(400).json({ error: `A dock named "${parsed.data.dockName}" already exists in this warehouse` });
        return;
      }
    }

    const updatedDock = await Dock.findByIdAndUpdate(
      id,
      { $set: parsed.data },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: 'Dock updated successfully',
      dock: updatedDock,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const deactivateDock = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse associated with this account' });
      return;
    }

    const dock = await Dock.findById(id);
    if (!dock) {
      res.status(404).json({ error: 'Dock not found' });
      return;
    }

    // Tenant Isolation Check
    if (dock.warehouseId.toString() !== warehouseId) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to manage this dock' });
      return;
    }

    dock.isActive = false;
    await dock.save();

    res.status(200).json({
      message: 'Dock deactivated successfully',
      dock,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
