import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { UserRole, User } from '../models/User.js';
import { hasApprovedAccess } from '../models/VendorAccess.js';

export interface JWTUser {
  userId: string;
  role: UserRole;
  warehouseId?: string;
  vendorId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTUser;
    }
  }
}

export const authenticateJWT = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Access token missing or malformed' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: 'JWT secret not configured' });
      return;
    }

    const decoded = jwt.verify(token, jwtSecret) as JWTUser;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }
};

export const requireRole = (roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Ensures the caller may act on the warehouse named in the request (body or query `warehouseId`).
 * - SUPER_ADMIN: any warehouse
 * - WAREHOUSE_ADMIN: only the warehouse in their JWT
 * - VENDOR: active account AND an APPROVED VendorAccess record for that warehouse
 *   (checked against the database on every request, so revocations apply immediately)
 */
export const requireWarehouseAccess = (source: 'body' | 'query') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const warehouseId = source === 'body' ? req.body?.warehouseId : req.query.warehouseId;
    if (typeof warehouseId !== 'string' || !Types.ObjectId.isValid(warehouseId)) {
      res.status(400).json({ error: 'A valid warehouseId is required' });
      return;
    }

    const { role } = req.user;

    if (role === 'SUPER_ADMIN') {
      next();
      return;
    }

    if (role === 'WAREHOUSE_ADMIN') {
      if (req.user.warehouseId !== warehouseId) {
        res.status(403).json({ error: 'Forbidden: You do not manage this warehouse' });
        return;
      }
      next();
      return;
    }

    try {
      const user = await User.findById(req.user.userId).select('status');
      if (!user || user.status !== 'APPROVED') {
        res.status(403).json({ error: 'Forbidden: Your account is not active' });
        return;
      }

      if (!(await hasApprovedAccess(req.user.userId, warehouseId))) {
        res.status(403).json({ error: 'Forbidden: You are not approved to book at this warehouse' });
        return;
      }
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error during access check' });
      return;
    }

    next();
  };
};
