import { Request, Response } from 'express';
import { AuditLog } from '../models/AuditLog.js';

/** Paginated audit trail for the admin's warehouse. Optional filters: action, entityType, search. */
export const listAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.user?.role === 'WAREHOUSE_ADMIN') {
      filter.warehouseId = req.user.warehouseId;
    } else if (typeof req.query.warehouseId === 'string' && req.query.warehouseId) {
      filter.warehouseId = req.query.warehouseId;
    }
    if (typeof req.query.action === 'string' && req.query.action) filter.action = req.query.action;
    if (typeof req.query.entityType === 'string' && req.query.entityType) filter.entityType = req.query.entityType;
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.message = { $regex: escaped, $options: 'i' };
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);

    const [logs, total, actions] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AuditLog.countDocuments(filter),
      AuditLog.distinct('action', filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
    ]);

    res.status(200).json({ logs, total, page, pages: Math.ceil(total / limit), actions: actions.sort() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
