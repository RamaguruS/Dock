import { Schema, model, Document, Types } from 'mongoose';

export interface IDock extends Document {
  warehouseId: Types.ObjectId;
  dockName: string;
  maxCapacityPerHour: number;
  isActive: boolean;
  /** Bumped inside every booking transaction so concurrent bookings on the same dock conflict and retry. */
  bookingLockVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const dockSchema = new Schema<IDock>(
  {
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse ID is required'],
      index: true,
    },
    dockName: {
      type: String,
      required: [true, 'Dock name is required'],
      trim: true,
    },
    maxCapacityPerHour: {
      type: Number,
      required: [true, 'Max capacity per hour is required'],
      min: [1, 'Capacity must be at least 1'],
      default: 1,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    bookingLockVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure dockName is unique within the same warehouse
dockSchema.index({ warehouseId: 1, dockName: 1 }, { unique: true });

export const Dock = model<IDock>('Dock', dockSchema);
