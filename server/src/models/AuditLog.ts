import { Schema, model, Document, Types } from 'mongoose';

export type AuditEntityType = 'BOOKING' | 'DOCK' | 'WAREHOUSE' | 'VENDOR_ACCESS' | 'WAITLIST' | 'USER' | 'SYSTEM';

export interface IAuditLog extends Document {
  warehouseId?: Types.ObjectId;
  actorId?: Types.ObjectId;
  actorRole?: string;
  actorName?: string;
  action: string; // e.g. BOOKING_CREATED, BOOKING_STATUS_CHANGED, DOCK_UPDATED
  entityType: AuditEntityType;
  entityId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    actorName: String,
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: String,
    message: { type: String, required: true },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ warehouseId: 1, createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
