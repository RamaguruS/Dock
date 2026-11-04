import { Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Dock, DOCK_DIRECTIONS, TRAILER_TYPES } from '../models/Dock.js';
import { Booking, INACTIVE_STATUSES } from '../models/Booking.js';
import { hasApprovedAccess } from '../models/VendorAccess.js';
import { audit } from '../services/audit.js';

const dockFields = {
  dockName: z.string().trim().min(1, 'Dock name is required').max(60),
  maxCapacityPerHour: z.number().int().min(1, 'Capacity must be at least 1').max(20),
  isActive: z.boolean(),
  direction: z.enum(DOCK_DIRECTIONS),
  supportedTrailerTypes: z.array(z.enum(TRAILER_TYPES)).min(1, 'Select at least one trailer type'),
  hazmatCertified: z.boolean(),
};

const createDockSchema = z.object({
  dockName: dockFields.dockName,
  maxCapacityPerHour: dockFields.maxCapacityPerHour.optional(),
  isActive: dockFields.isActive.optional(),
  direction: dockFields.direction.optional(),
  supportedTrailerTypes: dockFields.supportedTrailerTypes.optional(),
  hazmatCertified: dockFields.hazmatCertified.optional(),
});

const updateDockSchema = createDockSchema.partial();

const maintenanceSchema = z
  .object({
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    reason: z.string().trim().min(1, 'Reason is required').max(120),
  })
  .refine((v) => new Date(v.startTime) < new Date(v.endTime), 'Start must be before end');

/** Load a dock that belongs to the admin's warehouse, or send the error response. */
async function loadOwnDock(req: Request, res: Response) {
  const { id } = req.params;
  const warehouseId = req.user?.warehouseId;
  if (!warehouseId) {
    res.status(400).json({ error: 'No warehouse associated with this account' });
    return null;
  }
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid dock ID' });
    return null;
  }
  const dock = await Dock.findById(id);
  if (!dock) {
    res.status(404).json({ error: 'Dock not found' });
    return null;
  }
  // Tenant Isolation Check
  if (dock.warehouseId.toString() !== warehouseId) {
    res.status(403).json({ error: 'Forbidden: You do not have permission to manage this dock' });
    return null;
  }
  return dock;
}

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

    const existingDock = await Dock.findOne({ warehouseId, dockName: parsed.data.dockName });
    if (existingDock) {
      res.status(400).json({ error: `A dock named "${parsed.data.dockName}" already exists in this warehouse` });
      return;
    }

    const newDock = await Dock.create({ warehouseId, ...parsed.data });

    await audit({
      req,
      warehouseId,
      action: 'DOCK_CREATED',
      entityType: 'DOCK',
      entityId: newDock._id,
      message: `Dock ${newDock.dockName} created (${newDock.direction}, ${newDock.supportedTrailerTypes.join('/')}, capacity ${newDock.maxCapacityPerHour}${newDock.hazmatCertified ? ', hazmat' : ''})`,
    });

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
    // Warehouse Admins are pinned to their own warehouse; others pass ?warehouseId
    const warehouseId = req.user?.role === 'WAREHOUSE_ADMIN' ? req.user.warehouseId : (req.query.warehouseId as string);

    if (!warehouseId || !Types.ObjectId.isValid(warehouseId)) {
      res.status(400).json({ error: 'A valid warehouseId query parameter or warehouse association is required' });
      return;
    }

    // Vendors only see docks of warehouses that approved them
    if (req.user?.role === 'VENDOR' && !(await hasApprovedAccess(req.user.userId, warehouseId))) {
      res.status(403).json({ error: 'Forbidden: You are not approved to book at this warehouse' });
      return;
    }

    const query: Record<string, unknown> = { warehouseId };
    if (req.user?.role === 'VENDOR') query.isActive = true;
    const docks = await Dock.find(query).sort({ dockName: 1 });
    res.status(200).json({ docks });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const updateDock = async (req: Request, res: Response): Promise<void> => {
  try {
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

    const dock = await loadOwnDock(req, res);
    if (!dock) return;

    // If changing name, ensure uniqueness
    if (parsed.data.dockName && parsed.data.dockName !== dock.dockName) {
      const existingDock = await Dock.findOne({ warehouseId, dockName: parsed.data.dockName });
      if (existingDock) {
        res.status(400).json({ error: `A dock named "${parsed.data.dockName}" already exists in this warehouse` });
        return;
      }
    }

    const updatedDock = await Dock.findByIdAndUpdate(dock._id, { $set: parsed.data }, { new: true, runValidators: true });

    await audit({
      req,
      warehouseId,
      action: 'DOCK_UPDATED',
      entityType: 'DOCK',
      entityId: dock._id,
      message: `Dock ${updatedDock?.dockName} updated: ${Object.keys(parsed.data).join(', ')}`,
      metadata: parsed.data,
    });

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
    const dock = await loadOwnDock(req, res);
    if (!dock) return;

    dock.isActive = false;
    await dock.save();

    const upcoming = await Booking.countDocuments({
      dockId: dock._id,
      status: { $nin: INACTIVE_STATUSES },
      startTime: { $gt: new Date() },
    });

    await audit({
      req,
      warehouseId: dock.warehouseId,
      action: 'DOCK_DEACTIVATED',
      entityType: 'DOCK',
      entityId: dock._id,
      message: `Dock ${dock.dockName} deactivated (${upcoming} upcoming appointments need rescheduling)`,
    });

    res.status(200).json({
      message:
        upcoming > 0
          ? `Dock deactivated. ${upcoming} upcoming appointment(s) on this dock should be rescheduled.`
          : 'Dock deactivated successfully',
      dock,
      upcomingAppointments: upcoming,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

/** Schedule planned downtime. Returns the appointments that overlap it so they can be moved. */
export const addMaintenanceWindow = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }
    const dock = await loadOwnDock(req, res);
    if (!dock) return;

    const startTime = new Date(parsed.data.startTime);
    const endTime = new Date(parsed.data.endTime);
    dock.maintenanceWindows.push({ startTime, endTime, reason: parsed.data.reason });
    await dock.save();

    const affected = await Booking.find({
      dockId: dock._id,
      status: { $nin: INACTIVE_STATUSES },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    })
      .populate('vendorId', 'vendorCompany username')
      .sort({ startTime: 1 });

    await audit({
      req,
      warehouseId: dock.warehouseId,
      action: 'MAINTENANCE_SCHEDULED',
      entityType: 'DOCK',
      entityId: dock._id,
      message: `Maintenance on ${dock.dockName}: ${parsed.data.reason} (${startTime.toISOString()} → ${endTime.toISOString()}); ${affected.length} appointment(s) affected`,
    });

    res.status(201).json({
      message:
        affected.length > 0
          ? `Maintenance scheduled. ${affected.length} existing appointment(s) overlap and should be rescheduled.`
          : 'Maintenance scheduled',
      dock,
      affectedBookings: affected,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const removeMaintenanceWindow = async (req: Request, res: Response): Promise<void> => {
  try {
    const dock = await loadOwnDock(req, res);
    if (!dock) return;

    const window = dock.maintenanceWindows.id(req.params.windowId);
    if (!window) {
      res.status(404).json({ error: 'Maintenance window not found' });
      return;
    }
    const reason = window.reason;
    window.deleteOne();
    await dock.save();

    await audit({
      req,
      warehouseId: dock.warehouseId,
      action: 'MAINTENANCE_REMOVED',
      entityType: 'DOCK',
      entityId: dock._id,
      message: `Maintenance on ${dock.dockName} removed (${reason})`,
    });

    res.status(200).json({ message: 'Maintenance window removed', dock });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
