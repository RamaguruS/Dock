import { Router } from 'express';
import {
  createBooking,
  getBookings,
  updateBookingStatus,
  getAvailability,
  getAvailabilitySummary,
  getCalendarSummary,
} from '../controllers/bookingController.js';
import { authenticateJWT, requireApprovedVendor, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/', authenticateJWT, requireApprovedVendor, createBooking);
router.get('/', authenticateJWT, getBookings);
router.get('/availability', authenticateJWT, requireApprovedVendor, getAvailability);
router.get('/availability-summary', authenticateJWT, requireApprovedVendor, getAvailabilitySummary);
router.get('/calendar-summary', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), getCalendarSummary);
router.patch('/:id/status', authenticateJWT, updateBookingStatus);

export default router;
