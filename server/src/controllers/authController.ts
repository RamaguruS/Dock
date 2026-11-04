import { Request, Response } from 'express';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Warehouse } from '../models/Warehouse.js';
import { VendorAccess } from '../models/VendorAccess.js';

const objectIdString = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid ID');

// Registration Validation Schemas.
// SUPER_ADMIN is intentionally NOT registrable through the public API —
// create one with `npm run create-super-admin` on the server instead.
const baseRegisterSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6),
});

const warehouseAdminRegisterSchema = baseRegisterSchema.extend({
  role: z.literal('WAREHOUSE_ADMIN'),
  warehouseName: z.string().min(1, 'Warehouse name is required'),
  warehouseAddress: z.string().min(1, 'Warehouse address is required'),
  timezone: z.string().default('UTC'),
});

const vendorRegisterSchema = baseRegisterSchema.extend({
  role: z.literal('VENDOR'),
  vendorCompany: z.string().min(1, 'Vendor company name is required'),
  warehouseIds: z
    .array(objectIdString)
    .min(1, 'Select at least one warehouse to request access to')
    .max(50),
});

const registerSchema = z.discriminatedUnion('role', [
  warehouseAdminRegisterSchema,
  vendorRegisterSchema,
]);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { username, email, password, role } = parsed.data;

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      res.status(400).json({ error: 'Username or email already exists' });
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    if (role === 'WAREHOUSE_ADMIN') {
      // 1. Create a dummy/temporary User first (or create the Warehouse first)
      // To satisfy Mongoose validations:
      // We can create the User with warehouseId: undefined first, then create Warehouse, then update User.
      // But userSchema says warehouseId is REQUIRED if role is WAREHOUSE_ADMIN.
      // So let's create a temporary ObjectId to satisfy the validation, then update it. Or disable validation temporarily.
      // Yes! Generating ObjectIds in application code is a standard MongoDB/Mongoose feature!
      const userId = new Types.ObjectId();
      const warehouseId = new Types.ObjectId();

      const data = parsed.data as z.infer<typeof warehouseAdminRegisterSchema>;

      const newWarehouse = new Warehouse({
        _id: warehouseId,
        name: data.warehouseName,
        address: data.warehouseAddress,
        adminId: userId,
        timezone: data.timezone,
      });

      const newUser = new User({
        _id: userId,
        username,
        email,
        passwordHash,
        role,
        warehouseId: warehouseId,
      });

      // Save both
      await newWarehouse.save();
      await newUser.save();

      res.status(201).json({
        message: 'Warehouse Admin and Warehouse registered successfully',
        user: newUser,
        warehouse: newWarehouse,
      });
      return;
    } else {
      // VENDOR
      const data = parsed.data as z.infer<typeof vendorRegisterSchema>;
      const warehouseIds = [...new Set(data.warehouseIds)];

      const foundCount = await Warehouse.countDocuments({ _id: { $in: warehouseIds } });
      if (foundCount !== warehouseIds.length) {
        res.status(400).json({ error: 'One or more selected warehouses do not exist' });
        return;
      }

      const newUser = new User({
        username,
        email,
        passwordHash,
        role,
        vendorCompany: data.vendorCompany,
        status: 'APPROVED', // account is active; booking rights are granted per warehouse
      });
      await newUser.save();

      try {
        await VendorAccess.insertMany(
          warehouseIds.map((warehouseId) => ({ vendorId: newUser._id, warehouseId, status: 'PENDING' }))
        );
      } catch (accessError) {
        // Don't leave a vendor account behind with no access requests
        await User.deleteOne({ _id: newUser._id });
        throw accessError;
      }

      res.status(201).json({
        message: 'Vendor registered. Each selected warehouse must approve your access before you can book there.',
        user: newUser,
      });
      return;
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { email, password } = parsed.data;

    const user = await User.findOne({ email });
    if (!user) {
      res.status(400).json({ error: 'Invalid email or password' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(400).json({ error: 'Invalid email or password' });
      return;
    }

    if (user.status !== 'APPROVED') {
      res.status(403).json({
        error: `Your account status is ${user.status}. Please contact an administrator.`,
        status: user.status
      });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'JWT secret not configured' });
      return;
    }

    // Sign Token
    const token = jwt.sign(
      {
        userId: user._id,
        role: user.role,
        warehouseId: user.warehouseId?.toString(),
        vendorId: user.role === 'VENDOR' ? user._id.toString() : undefined,
      },
      jwtSecret,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await User.findById(req.user.userId).populate('warehouseId');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
