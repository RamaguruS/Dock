/**
 * Notifications: always stored in-app; additionally delivered by
 *   - email via Resend  (RESEND_API_KEY, optional EMAIL_FROM)
 *   - SMS via Twilio    (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)
 * when those environment variables are configured. Delivery never blocks or fails the request.
 */
import { Types } from 'mongoose';
import { Notification, ChannelStatus } from '../models/Notification.js';
import { User } from '../models/User.js';
import { logger } from '../config/logger.js';

export interface NotifyInput {
  type: string;
  title: string;
  message: string;
  bookingId?: string | Types.ObjectId;
  /** Phone number for an SMS copy (e.g. the truck driver), if SMS is configured. */
  smsTo?: string;
  email?: boolean; // default true
}

export const notificationChannels = () => ({
  email: !!process.env.RESEND_API_KEY,
  sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
});

async function sendEmail(to: string, subject: string, text: string): Promise<ChannelStatus> {
  if (!process.env.RESEND_API_KEY) return 'SKIPPED';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'SmartDock <onboarding@resend.dev>',
        to: [to],
        subject: `SmartDock: ${subject}`,
        text: `${text}\n\n— SmartDock Dock Appointment Scheduling`,
      }),
    });
    if (!res.ok) {
      logger.warn(`[NOTIFY] Email to ${to} failed: ${res.status} ${await res.text()}`);
      return 'FAILED';
    }
    return 'SENT';
  } catch (error) {
    logger.warn(`[NOTIFY] Email to ${to} failed: ${(error as Error).message}`);
    return 'FAILED';
  }
}

async function sendSms(to: string, body: string): Promise<ChannelStatus> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM_NUMBER: from } = process.env;
  if (!sid || !token || !from) return 'SKIPPED';
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: `SmartDock: ${body}` }).toString(),
    });
    if (!res.ok) {
      logger.warn(`[NOTIFY] SMS to ${to} failed: ${res.status} ${await res.text()}`);
      return 'FAILED';
    }
    return 'SENT';
  } catch (error) {
    logger.warn(`[NOTIFY] SMS to ${to} failed: ${(error as Error).message}`);
    return 'FAILED';
  }
}

/** Notify one user (in-app + optional email/SMS). */
export async function notifyUser(userId: string | Types.ObjectId, input: NotifyInput): Promise<void> {
  try {
    const notification = await Notification.create({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      bookingId: input.bookingId,
    });

    // Deliver external channels in the background
    void (async () => {
      const user = await User.findById(userId).select('email');
      const email = input.email === false || !user ? 'SKIPPED' : await sendEmail(user.email, input.title, input.message);
      const sms = input.smsTo ? await sendSms(input.smsTo, `${input.title} - ${input.message}`) : 'SKIPPED';
      if (email !== 'SKIPPED' || sms !== 'SKIPPED') {
        await Notification.updateOne({ _id: notification._id }, { $set: { email, sms } });
      }
    })().catch((error) => logger.warn(`[NOTIFY] Delivery error: ${(error as Error).message}`));
  } catch (error) {
    logger.error(`[NOTIFY] Failed to create notification: ${(error as Error).message}`);
  }
}

/** Notify every admin of a warehouse. */
export async function notifyWarehouseAdmins(warehouseId: string | Types.ObjectId, input: NotifyInput): Promise<void> {
  const admins = await User.find({ role: 'WAREHOUSE_ADMIN', warehouseId }).select('_id');
  await Promise.all(admins.map((a) => notifyUser(a._id, { ...input, smsTo: undefined })));
}

/** "Tue 12 Nov, 09:00" in the warehouse's local time. */
export function formatSlot(start: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(start);
}
