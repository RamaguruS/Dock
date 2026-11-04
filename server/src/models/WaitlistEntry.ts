import { Schema, model, Document, Types } from 'mongoose';
import { TRAILER_TYPES, TrailerType } from './Dock.js';

export type WaitlistStatus = 'WAITING' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';

/**
 * A carrier queued for a full slot. When capacity frees up (cancellation, rejection,
 * reschedule) the oldest compatible entry is automatically turned into a booking.
 */
export interface IWaitlistEntry extends Document {
  vendorId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  dockId?: Types.ObjectId; // unset = any compatible dock
  startTime: Date;
  endTime: Date;
  direction: 'INBOUND' | 'OUTBOUND';
  trailerType: TrailerType;
  hazmat: boolean;
  truckNumber: string;
  driverName: string;
  driverPhone: string;
  referenceNumber?: string;
  palletCount?: number;
  status: WaitlistStatus;
  fulfilledBookingId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const waitlistSchema = new Schema<IWaitlistEntry>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    dockId: { type: Schema.Types.ObjectId, ref: 'Dock' },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], default: 'INBOUND' },
    trailerType: { type: String, enum: TRAILER_TYPES, default: 'DRY_VAN' },
    hazmat: { type: Boolean, default: false },
    truckNumber: { type: String, required: true, trim: true },
    driverName: { type: String, required: true, trim: true },
    driverPhone: { type: String, required: true, trim: true },
    referenceNumber: { type: String, trim: true },
    palletCount: Number,
    status: {
      type: String,
      enum: ['WAITING', 'FULFILLED', 'CANCELLED', 'EXPIRED'],
      default: 'WAITING',
      index: true,
    },
    fulfilledBookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  },
  { timestamps: true }
);

waitlistSchema.index({ warehouseId: 1, status: 1, startTime: 1, createdAt: 1 });

export const WaitlistEntry = model<IWaitlistEntry>('WaitlistEntry', waitlistSchema);
