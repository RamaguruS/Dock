import { Request, Response } from 'express';
import { z } from 'zod';
import { Warehouse } from '../models/Warehouse.js';

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

const dailyOperatingHourSchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
  start: z.string().regex(timeRegex, 'Start time must be in HH:MM format'),
  end: z.string().regex(timeRegex, 'End time must be in HH:MM format'),
  isOpen: z.boolean(),
});

const operatingHoursSchema = z.object({
  operatingHours: z.array(dailyOperatingHourSchema).length(7, 'Must specify operating hours for all 7 days'),
});

export const updateOperatingHours = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouseId = req.user?.warehouseId;
    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse associated with this account' });
      return;
    }

    const parsed = operatingHoursSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    // Double check that the admin is authorized for this warehouse (in addition to token)
    if (req.user?.role !== 'SUPER_ADMIN' && warehouse.adminId.toString() !== req.user?.userId) {
      res.status(403).json({ error: 'Forbidden: You do not manage this warehouse' });
      return;
    }

    warehouse.operatingHours = parsed.data.operatingHours;
    await warehouse.save();

    res.status(200).json({
      message: 'Operating hours updated successfully',
      warehouse,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
export const getMyWarehouse = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouseId = req.user?.warehouseId;
    if (!warehouseId) {
      res.status(400).json({ error: 'No warehouse associated with this account' });
      return;
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      res.status(404).json({ error: 'Warehouse not found' });
      return;
    }

    res.status(200).json({ warehouse });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const listWarehouses = async (req: Request, res: Response): Promise<void> => {
  try {
    const warehouses = await Warehouse.find().select('name address timezone');
    res.status(200).json({ warehouses });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
