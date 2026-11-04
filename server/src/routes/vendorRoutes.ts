import { Router } from 'express';
import {
  getPendingVendors,
  updateVendorStatus,
  getMyAccess,
  requestAccess,
  getCarrierScorecards,
  getMyScore,
} from '../controllers/vendorController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();
const admin = [authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN'])];
const vendor = [authenticateJWT, requireRole(['VENDOR'])];

// Vendor self-service
router.get('/me/access', ...vendor, getMyAccess);
router.post('/me/access', ...vendor, requestAccess);
router.get('/me/score', ...vendor, getMyScore);

// Admin review of access requests and carrier performance for their warehouse
router.get('/pending', ...admin, getPendingVendors);
router.get('/scorecards', ...admin, getCarrierScorecards);
router.patch('/:id/status', ...admin, updateVendorStatus);

export default router;
