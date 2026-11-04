import { Router } from 'express';
import { getPendingVendors, updateVendorStatus, getMyAccess, requestAccess } from '../controllers/vendorController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

// Vendor self-service
router.get('/me/access', authenticateJWT, requireRole(['VENDOR']), getMyAccess);
router.post('/me/access', authenticateJWT, requireRole(['VENDOR']), requestAccess);

// Admin review of access requests for their warehouse
router.get('/pending', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), getPendingVendors);
router.patch('/:id/status', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), updateVendorStatus);

export default router;
