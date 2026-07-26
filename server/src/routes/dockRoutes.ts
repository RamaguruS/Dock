import { Router } from 'express';
import { createDock, getDocks, updateDock, deactivateDock } from '../controllers/dockController.js';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), createDock);
router.get('/', authenticateJWT, getDocks);
router.put('/:id', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), updateDock);
router.patch('/:id/deactivate', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), deactivateDock);

export default router;
