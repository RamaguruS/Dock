import { Schema, model, Document, Types } from 'mongoose';

export type VendorAccessStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * A vendor's permission to book at one specific warehouse.
 * Each warehouse admin approves or rejects only the requests for their own warehouse,
 * and a vendor may only book at warehouses where their access is APPROVED.
 */
export interface IVendorAccess extends Document {
  vendorId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  status: VendorAccessStatus;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const vendorAccessSchema = new Schema<IVendorAccess>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Vendor ID is required'],
      index: true,
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'APPROVED', 'REJECTED'],
        message: '{VALUE} is not a valid access status',
      },
      default: 'PENDING',
      index: true,
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    decidedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// One access record per vendor/warehouse pair
vendorAccessSchema.index({ vendorId: 1, warehouseId: 1 }, { unique: true });

export const VendorAccess = model<IVendorAccess>('VendorAccess', vendorAccessSchema);

/** True when the vendor holds APPROVED access to the warehouse. */
export const hasApprovedAccess = async (vendorId: string, warehouseId: string): Promise<boolean> => {
  if (!Types.ObjectId.isValid(vendorId) || !Types.ObjectId.isValid(warehouseId)) return false;
  const access = await VendorAccess.exists({ vendorId, warehouseId, status: 'APPROVED' });
  return !!access;
};
