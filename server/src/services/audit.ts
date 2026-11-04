import { Request } from 'express';
import { AuditLog, AuditEntityType } from '../models/AuditLog.js';
import { User } from '../models/User.js';
import { logger } from '../config/logger.js';

export interface AuditInput {
  req?: Request;
  /** Use instead of req for system jobs */
  system?: boolean;
  warehouseId?: string | { toString(): string };
  action: string;
  entityType: AuditEntityType;
  entityId?: string | { toString(): string };
  message: string;
  metadata?: Record<string, unknown>;
}

const nameCache = new Map<string, string>();

async function actorName(userId: string): Promise<string | undefined> {
  if (nameCache.has(userId)) return nameCache.get(userId);
  const user = await User.findById(userId).select('username vendorCompany role');
  if (!user) return undefined;
  const name = user.role === 'VENDOR' && user.vendorCompany ? `${user.vendorCompany} (${user.username})` : user.username;
  nameCache.set(userId, name);
  return name;
}

/** Persist an audit trail entry. Never throws: auditing must not break the request. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const user = input.req?.user;
    await AuditLog.create({
      warehouseId: input.warehouseId?.toString(),
      actorId: user?.userId,
      actorRole: input.system ? 'SYSTEM' : user?.role,
      actorName: input.system ? 'SmartDock automation' : user ? await actorName(user.userId) : undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId?.toString(),
      message: input.message,
      metadata: input.metadata,
    });
    logger.info(`[AUDIT] ${input.action}: ${input.message}`);
  } catch (error) {
    logger.error(`[AUDIT] Failed to write audit log: ${(error as Error).message}`);
  }
}
