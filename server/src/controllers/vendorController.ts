import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { logger } from '../config/logger.js';

export const getPendingVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const pendingVendors = await User.find({ role: 'VENDOR', status: 'PENDING' });
    res.status(200).json({ vendors: pendingVendors });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

const vendorStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});

export const updateVendorStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const parsed = vendorStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const vendor = await User.findOne({ _id: id, role: 'VENDOR' });
    if (!vendor) {
      res.status(404).json({ error: 'Vendor not found' });
      return;
    }

    vendor.status = parsed.data.status;
    await vendor.save();

    logger.info(`[AUDIT] Vendor status updated: ID ${vendor._id}, Email ${vendor.email}, Status ${parsed.data.status}, Action by Admin: ${req.user?.userId}`);

    res.status(200).json({
      message: `Vendor account has been ${parsed.data.status.toLowerCase()}`,
      vendor,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
