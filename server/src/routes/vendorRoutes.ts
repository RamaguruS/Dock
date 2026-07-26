import { Router } from 'express';
import { getPendingVendors, updateVendorStatus } from '../controllers/vendorController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/pending', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), getPendingVendors);
router.patch('/:id/status', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), updateVendorStatus);

export default router;
