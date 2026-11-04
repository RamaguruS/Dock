import { Router, Request, Response } from 'express';
import { authenticateJWT, requireRole } from '../middleware/authMiddleware.js';
import { isDemoMode, seedDemoData, DEMO_ADMIN_EMAIL, DEMO_CARRIER_EMAIL, DEMO_PASSWORD } from '../services/seed.js';
import { User } from '../models/User.js';
import { runJobsOnce } from '../services/jobs.js';

const router = Router();

/** Public: tells the login page whether to show the demo account shortcuts. */
router.get('/info', (_req: Request, res: Response) => {
  if (!isDemoMode()) {
    res.status(200).json({ demoMode: false });
    return;
  }
  res.status(200).json({
    demoMode: true,
    accounts: [
      { label: 'Warehouse manager (Chennai DC)', email: DEMO_ADMIN_EMAIL, password: DEMO_PASSWORD },
      { label: 'Carrier (Swift Freight Lines)', email: DEMO_CARRIER_EMAIL, password: DEMO_PASSWORD },
      { label: 'Carrier awaiting approval (Nova Movers)', email: 'nova@smartdock.demo', password: DEMO_PASSWORD },
    ],
  });
});

/** Demo admin only: wipe and regenerate all demo data relative to "now". */
router.post('/reset', authenticateJWT, requireRole(['WAREHOUSE_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
  if (!isDemoMode()) {
    res.status(404).json({ error: 'Demo mode is not enabled' });
    return;
  }
  const user = await User.findById(req.user?.userId).select('email');
  if (user?.email !== DEMO_ADMIN_EMAIL) {
    res.status(403).json({ error: 'Only the demo warehouse manager can reset demo data' });
    return;
  }
  try {
    const result = await seedDemoData();
    await runJobsOnce();
    res.status(200).json({ message: `Demo data reset (${result.bookings} appointments). Please log in again.` });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
