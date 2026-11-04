import { Schema, model, Document, Types } from 'mongoose';
import { TRAILER_TYPES, TrailerType } from './Dock.js';

export const BOOKING_STATUSES = [
  'PENDING',     // requested by carrier, awaiting warehouse approval
  'APPROVED',    // confirmed appointment
  'CHECKED_IN',  // truck arrived at the gate / waiting in the yard
  'IN_PROGRESS', // at the dock door, loading or unloading
  'COMPLETED',   // departed
  'CANCELLED',
  'REJECTED',
  'NO_SHOW',     // approved but never arrived
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type LoadDirection = 'INBOUND' | 'OUTBOUND';
export type ArrivalStatus = 'ON_TIME' | 'LATE';

/** Statuses that no longer occupy dock capacity. */
export const INACTIVE_STATUSES: BookingStatus[] = ['CANCELLED', 'REJECTED', 'NO_SHOW'];

export interface IRescheduleEntry {
  fromStart: Date;
  fromEnd: Date;
  fromDockId: Types.ObjectId;
  toStart: Date;
  toEnd: Date;
  toDockId: Types.ObjectId;
  by: Types.ObjectId;
  at: Date;
}

export interface IBooking extends Document {
  warehouseId: Types.ObjectId;
  dockId: Types.ObjectId;
  vendorId: Types.ObjectId;
  truckNumber: string;
  driverName: string;
  driverPhone: string;
  startTime: Date; // UTC
  endTime: Date;   // UTC
  status: BookingStatus;

  // Load details (supply-chain context)
  direction: LoadDirection;
  trailerType: TrailerType;
  hazmat: boolean;
  referenceNumber?: string; // PO / ASN / shipment reference
  palletCount?: number;
  cargoDescription?: string;

  // Recurring appointments share a group id
  recurrenceGroupId?: string;

  // Yard / gate events
  checkedInAt?: Date;
  dockStartedAt?: Date;
  completedAt?: Date;
  arrivalStatus?: ArrivalStatus;
  lateByMinutes?: number;

  cancelReason?: string;
  reminderSentAt?: Date;
  rescheduleHistory: IRescheduleEntry[];

  createdAt: Date;
  updatedAt: Date;
}

const rescheduleEntrySchema = new Schema<IRescheduleEntry>(
  {
    fromStart: Date,
    fromEnd: Date,
    fromDockId: { type: Schema.Types.ObjectId, ref: 'Dock' },
    toStart: Date,
    toEnd: Date,
    toDockId: { type: Schema.Types.ObjectId, ref: 'Dock' },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: Date,
  },
  { _id: false }
);

const bookingSchema = new Schema<IBooking>(
  {
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Warehouse ID is required'],
      index: true,
    },
    dockId: {
      type: Schema.Types.ObjectId,
      ref: 'Dock',
      required: [true, 'Dock ID is required'],
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Vendor ID is required'],
      index: true,
    },
    truckNumber: {
      type: String,
      required: [true, 'Truck number is required'],
      trim: true,
    },
    driverName: {
      type: String,
      required: [true, 'Driver name is required'],
      trim: true,
    },
    driverPhone: {
      type: String,
      required: [true, 'Driver phone is required'],
      trim: true,
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required'],
      index: true,
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: [...BOOKING_STATUSES],
        message: '{VALUE} is not a valid booking status',
      },
      default: 'PENDING',
      index: true,
    },
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], default: 'INBOUND' },
    trailerType: { type: String, enum: TRAILER_TYPES, default: 'DRY_VAN' },
    hazmat: { type: Boolean, default: false },
    referenceNumber: { type: String, trim: true, maxlength: 60 },
    palletCount: { type: Number, min: 0, max: 100 },
    cargoDescription: { type: String, trim: true, maxlength: 200 },
    recurrenceGroupId: { type: String, index: true },
    checkedInAt: Date,
    dockStartedAt: Date,
    completedAt: Date,
    arrivalStatus: { type: String, enum: ['ON_TIME', 'LATE'] },
    lateByMinutes: Number,
    cancelReason: { type: String, trim: true, maxlength: 200 },
    reminderSentAt: Date,
    rescheduleHistory: {
      type: [rescheduleEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for searching and overlap queries
bookingSchema.index({ dockId: 1, status: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ warehouseId: 1, startTime: 1 });

export const Booking = model<IBooking>('Booking', bookingSchema);
