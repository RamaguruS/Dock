import { Router } from 'express';
import {
  createDock,
  getDocks,
  updateDock,
  deactivateDock,
  addMaintenanceWindow,
  removeMaintenanceWindow,
} from '../controllers/dockController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();
const admin = [authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN'])];

router.post('/', ...admin, createDock);
router.get('/', authenticateJWT, getDocks);
router.put('/:id', ...admin, updateDock);
router.patch('/:id/deactivate', ...admin, deactivateDock);
router.post('/:id/maintenance', ...admin, addMaintenanceWindow);
router.delete('/:id/maintenance/:windowId', ...admin, removeMaintenanceWindow);

export default router;
