import { Router } from 'express';
import {
  updateOperatingHours,
  updateSchedulingSettings,
  addBlackoutDate,
  removeBlackoutDate,
  getMyWarehouse,
  listWarehouses,
} from '../controllers/warehouseController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();
const warehouseAdmin = [authenticateJWT, requireRole(['WAREHOUSE_ADMIN'])];

// Public: vendors pick warehouses to request access to while signing up (name/address/timezone only)
router.get('/', listWarehouses);
router.get('/my', ...warehouseAdmin, getMyWarehouse);
router.put('/operating-hours', ...warehouseAdmin, updateOperatingHours);
router.put('/settings', ...warehouseAdmin, updateSchedulingSettings);
router.post('/blackouts', ...warehouseAdmin, addBlackoutDate);
router.delete('/blackouts/:date', ...warehouseAdmin, removeBlackoutDate);

export default router;
