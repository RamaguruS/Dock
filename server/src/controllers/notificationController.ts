import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { notificationChannels } from '../services/notifications.js';

export const listNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const [notifications, unread] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({ userId, read: false }),
    ]);
    res.status(200).json({ notifications, unread, channels: notificationChannels() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const markNotificationRead = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }
    await Notification.updateOne({ _id: req.params.id, userId: req.user!.userId }, { $set: { read: true } });
    res.status(200).json({ message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const markAllNotificationsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    await Notification.updateMany({ userId: req.user!.userId, read: false }, { $set: { read: true } });
    res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};
