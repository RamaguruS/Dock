import { Schema, model, Document, Types } from 'mongoose';

export type BookingStatus = 'PENDING' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';

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
  createdAt: Date;
  updatedAt: Date;
}

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
        values: ['PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED'],
        message: '{VALUE} is not a valid booking status',
      },
      default: 'PENDING',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for searching and overlap queries
bookingSchema.index({ dockId: 1, status: 1, startTime: 1, endTime: 1 });

export const Booking = model<IBooking>('Booking', bookingSchema);
