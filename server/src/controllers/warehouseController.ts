import { Request, Response } from 'express';
import { z } from 'zod';
import { Warehouse, SLOT_DURATIONS } from '../models/Warehouse.js';
import { audit } from '../services/audit.js';

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

const dailyOperatingHourSchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  start: z.string().regex(timeRegex, 'Start time must be in HH:MM format'),
  end: z.string().regex(timeRegex, 'End time must be in HH:MM format'),
  isOpen: z.boolean(),
});

const operatingHoursSchema = z.object({
  operatingHours: z
    .array(dailyOperatingHourSchema)
    .length(7, 'Must specify operating hours for all 7 days')
    .refine((days) => days.every((d) => !d.isOpen || d.start < d.end), 'Opening time must be before closing time'),
});

const settingsSchema = z.object({
  slotDurationMinutes: z
    .number()
    .refine((v) => (SLOT_DURATIONS as readonly number[]).includes(v), 'Slot length must be 15, 30, 60 or 90 minutes')
    .optional(),
  bufferMinutes: z.number().int().min(0).max(120).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(240).optional(),
  noShowGraceMinutes: z.number().int().min(5).max(480).optional(),
});

const blackoutSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason: z.string().trim().min(1, 'Reason is required').max(120),
});

async function loadOwnWarehouse(req: Request, res: Response) {
  const warehouseId = req.user?.warehouseId;
  if (!warehouseId) {
    res.status(400).json({ error: 'No warehouse associated with this account' });
    return null;
  }
  const warehouse = await Warehouse.findById(warehouseId);
  if (!warehouse) {
    res.status(404).json({ error: 'Warehouse not found' });
    return null;
  }
  return warehouse;
}

export const updateOperatingHours = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = operatingHoursSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const warehouse = await loadOwnWarehouse(req, res);
    if (!warehouse) return;

    warehouse.operatingHours = parsed.data.operatingHours;
    await warehouse.save();

    await audit({
      req,
      warehouseId: warehouse._id,
      action: 'OPERATING_HOURS_UPDATED',
      entityType: 'WAREHOUSE',
      entityId: warehouse._id,
      message: `Operating hours updated: ${parsed.data.operatingHours
        .map((d) => `${d.day.slice(0, 3)} ${d.isOpen ? `${d.start}-${d.end}` : 'closed'}`)
        .join(', ')}`,
    });

    res.status(200).json({
      message: 'Operating hours updated successfully',
      warehouse,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

/** Slot length, buffer between slots, late threshold and no-show grace period. */
export const updateSchedulingSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }
    const warehouse = await loadOwnWarehouse(req, res);
    if (!warehouse) return;

    Object.assign(warehouse, parsed.data);
    await warehouse.save();

    await audit({
      req,
      warehouseId: warehouse._id,
      action: 'SCHEDULING_SETTINGS_UPDATED',
      entityType: 'WAREHOUSE',
      entityId: warehouse._id,
      message: `Scheduling rules: ${warehouse.slotDurationMinutes}-min slots, ${warehouse.bufferMinutes}-min buffer, late after ${warehouse.lateThresholdMinutes} min, no-show after ${warehouse.noShowGraceMinutes} min`,
      metadata: parsed.data,
    });

    res.status(200).json({
      message: 'Scheduling settings updated. Existing appointments keep their times.',
      warehouse,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const addBlackoutDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = blackoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }
    const warehouse = await loadOwnWarehouse(req, res);
    if (!warehouse) return;

    if (warehouse.blackoutDates.some((b) => b.date === parsed.data.date)) {
      res.status(409).json({ error: 'That date is already a blackout date' });
      return;
    }
    warehouse.blackoutDates.push(parsed.data);
    warehouse.blackoutDates.sort((a, b) => a.date.localeCompare(b.date));
    await warehouse.save();

    await audit({
      req,
      warehouseId: warehouse._id,
      action: 'BLACKOUT_ADDED',
      entityType: 'WAREHOUSE',
      entityId: warehouse._id,
      message: `Blackout date ${parsed.data.date} added: ${parsed.data.reason}`,
    });

    res.status(201).json({ message: 'Blackout date added', warehouse });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const removeBlackoutDate = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouse = await loadOwnWarehouse(req, res);
    if (!warehouse) return;

    const before = warehouse.blackoutDates.length;
    warehouse.blackoutDates = warehouse.blackoutDates.filter((b) => b.date !== req.params.date);
    if (warehouse.blackoutDates.length === before) {
      res.status(404).json({ error: 'Blackout date not found' });
      return;
    }
    await warehouse.save();

    await audit({
      req,
      warehouseId: warehouse._id,
      action: 'BLACKOUT_REMOVED',
      entityType: 'WAREHOUSE',
      entityId: warehouse._id,
      message: `Blackout date ${req.params.date} removed`,
    });

    res.status(200).json({ message: 'Blackout date removed', warehouse });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getMyWarehouse = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouse = await loadOwnWarehouse(req, res);
    if (!warehouse) return;
    res.status(200).json({ warehouse });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const listWarehouses = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouses = await Warehouse.find().select('name address timezone').sort({ name: 1 });
    res.status(200).json({ warehouses });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
