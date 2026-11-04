import { Router } from 'express';
import {
  createBooking,
  getBookings,
  updateBookingStatus,
  rescheduleBooking,
  cancelSeries,
  getAvailability,
  getAvailabilitySummary,
  getCalendarSummary,
} from '../controllers/bookingController.js';
import { authenticateJWT, requireWarehouseAccess, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/', authenticateJWT, requireRole(['VENDOR']), requireWarehouseAccess('body'), createBooking);
router.get('/', authenticateJWT, getBookings);
router.get('/availability', authenticateJWT, requireWarehouseAccess('query'), getAvailability);
router.get('/availability-summary', authenticateJWT, requireWarehouseAccess('query'), getAvailabilitySummary);
router.get('/calendar-summary', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), getCalendarSummary);
router.patch('/series/:groupId/cancel', authenticateJWT, cancelSeries);
router.patch('/:id/status', authenticateJWT, updateBookingStatus);
router.patch('/:id/reschedule', authenticateJWT, rescheduleBooking);

export default router;
