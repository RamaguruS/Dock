import { Router } from 'express';
import { updateOperatingHours, getMyWarehouse, listWarehouses } from '../controllers/warehouseController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

// Public: vendors pick warehouses to request access to while signing up (name/address/timezone only)
router.get('/', listWarehouses);
router.get('/my', authenticateJWT, requireRole(['WAREHOUSE_ADMIN']), getMyWarehouse);
router.put('/operating-hours', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), updateOperatingHours);

export default router;
