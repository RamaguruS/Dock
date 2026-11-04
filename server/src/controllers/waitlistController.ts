import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { Warehouse } from '../models/Warehouse.js';
import { TRAILER_TYPES } from '../models/Dock.js';
import { computeDayAvailability, localDateString, validateSlotRequest } from '../services/scheduling.js';
import { audit } from '../services/audit.js';
import { formatSlot, notifyWarehouseAdmins } from '../services/notifications.js';

const objectIdString = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), 'Invalid ID');

const joinSchema = z.object({
  warehouseId: objectIdString,
  dockId: objectIdString.optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('INBOUND'),
  trailerType: z.enum(TRAILER_TYPES).default('DRY_VAN'),
  hazmat: z.boolean().default(false),
  truckNumber: z.string().trim().min(1).max(30),
  driverName: z.string().trim().min(1).max(60),
  driverPhone: z.string().trim().min(5).max(20),
  referenceNumber: z.string().trim().max(60).optional(),
  palletCount: z.number().int().min(0).max(100).optional(),
});

/** Join the waitlist for a full slot (specific dock, or any compatible dock). */
export const joinWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }
    const data = parsed.data;
    const startTime = new Date(data.startTime);
    const endTime = new Date(data.endTime);
    const load = { direction: data.direction, trailerType: data.trailerType, hazmat: data.hazmat };

    const warehouse = await Warehouse.findById(data.warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    if (data.dockId) {
      const check = await validateSlotRequest(data.warehouseId, warehouse, data.dockId, startTime, endTime, load);
      if (!check.ok) {
        res.status(check.status).json({ error: check.error });
        return;
      }
    } else if (startTime <= new Date()) {
      res.status(400).json({ error: 'Start time must be in the future' });
      return;
    }

    // The waitlist is only for slots that are actually full
    const day = await computeDayAvailability(data.warehouseId, localDateString(startTime, warehouse.timezone), warehouse, {
      filterDockId: data.dockId,
      load,
    });
    const matching = day.docks
      .map((d) => d.slots.find((s) => s.startTime === startTime.toISOString() && s.endTime === endTime.toISOString()))
      .filter(Boolean);
    if (matching.length === 0) {
      res.status(400).json({ error: 'No compatible dock offers this slot' });
      return;
    }
    if (matching.some((s) => s!.available)) {
      res.status(409).json({ error: 'This slot still has free capacity — book it directly instead of waitlisting' });
      return;
    }

    const duplicate = await WaitlistEntry.exists({
      vendorId: req.user!.userId,
      warehouseId: data.warehouseId,
      startTime,
      status: 'WAITING',
    });
    if (duplicate) {
      res.status(409).json({ error: 'You are already on the waitlist for this slot' });
      return;
    }

    const entry = await WaitlistEntry.create({ ...data, vendorId: req.user!.userId, startTime, endTime });
    const position = await WaitlistEntry.countDocuments({
      warehouseId: data.warehouseId,
      startTime,
      status: 'WAITING',
      createdAt: { $lte: entry.createdAt },
    });

    const when = formatSlot(startTime, warehouse.timezone);
    await audit({
      req,
      warehouseId: data.warehouseId,
      action: 'WAITLIST_JOINED',
      entityType: 'WAITLIST',
      entityId: entry._id,
      message: `Truck ${data.truckNumber} joined the waitlist for ${when} (position ${position})`,
    });
    await notifyWarehouseAdmins(data.warehouseId, {
      type: 'WAITLIST_JOINED',
      title: 'Carrier joined the waitlist',
      message: `Truck ${data.truckNumber} is waiting for ${when} (position ${position}).`,
    });

    res.status(201).json({ message: `Added to the waitlist (position ${position})`, entry, position });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

/** Carrier: own entries. Admin: waiting entries for their warehouse. */
export const listWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.user?.role === 'VENDOR') {
      filter.vendorId = req.user.userId;
    } else if (req.user?.role === 'WAREHOUSE_ADMIN') {
      filter.warehouseId = req.user.warehouseId;
      filter.status = 'WAITING';
    }

    const entries = await WaitlistEntry.find(filter)
      .populate('warehouseId', 'name timezone')
      .populate('dockId', 'dockName')
      .populate('vendorId', 'username vendorCompany')
      .sort({ startTime: 1, createdAt: 1 })
      .limit(500);

    res.status(200).json({ entries });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const leaveWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }
    const filter: Record<string, unknown> = { _id: id, status: 'WAITING' };
    if (req.user?.role === 'VENDOR') filter.vendorId = req.user.userId;
    else if (req.user?.role === 'WAREHOUSE_ADMIN') filter.warehouseId = req.user.warehouseId;

    const entry = await WaitlistEntry.findOneAndUpdate(filter, { $set: { status: 'CANCELLED' } }, { new: true });
    if (!entry) {
      res.status(404).json({ error: 'Waitlist entry not found' });
      return;
    }
    await audit({
      req,
      warehouseId: entry.warehouseId,
      action: 'WAITLIST_LEFT',
      entityType: 'WAITLIST',
      entityId: entry._id,
      message: `Waitlist entry for truck ${entry.truckNumber} removed`,
    });
    res.status(200).json({ message: 'Removed from waitlist', entry });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
