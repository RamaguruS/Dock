import { Schema, model, Document, Types } from 'mongoose';

export type ChannelStatus = 'SENT' | 'SKIPPED' | 'FAILED';

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: string; // BOOKING_CREATED, BOOKING_APPROVED, REMINDER, WAITLIST_ASSIGNED, ...
  title: string;
  message: string;
  bookingId?: Types.ObjectId;
  read: boolean;
  email: ChannelStatus;
  sms: ChannelStatus;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    read: { type: Boolean, default: false, index: true },
    email: { type: String, enum: ['SENT', 'SKIPPED', 'FAILED'], default: 'SKIPPED' },
    sms: { type: String, enum: ['SENT', 'SKIPPED', 'FAILED'], default: 'SKIPPED' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
