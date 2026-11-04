import { Router } from 'express';
import { joinWaitlist, listWaitlist, leaveWaitlist } from '../controllers/waitlistController.js';
import { getAnalytics } from '../controllers/analyticsController.js';
import { listAuditLogs } from '../controllers/auditController.js';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notificationController.js';
import { authenticateJWT, requireRole, requireWarehouseAccess } from '../middleware/authMiddleware.js';

const admin = [authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN'])];

export const waitlistRoutes = Router();
waitlistRoutes.post('/', authenticateJWT, requireRole(['VENDOR']), requireWarehouseAccess('body'), joinWaitlist);
waitlistRoutes.get('/', authenticateJWT, listWaitlist);
waitlistRoutes.delete('/:id', authenticateJWT, leaveWaitlist);

export const analyticsRoutes = Router();
analyticsRoutes.get('/', ...admin, getAnalytics);

export const auditRoutes = Router();
auditRoutes.get('/', ...admin, listAuditLogs);

export const notificationRoutes = Router();
notificationRoutes.get('/', authenticateJWT, listNotifications);
notificationRoutes.post('/read-all', authenticateJWT, markAllNotificationsRead);
notificationRoutes.patch('/:id/read', authenticateJWT, markNotificationRead);
