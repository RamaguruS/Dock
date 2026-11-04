import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorMiddleware.js';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import warehouseRoutes from './routes/warehouseRoutes.js';
import dockRoutes from './routes/dockRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import demoRoutes from './routes/demoRoutes.js';
import { waitlistRoutes, analyticsRoutes, auditRoutes, notificationRoutes } from './routes/opsRoutes.js';
import { startJobs } from './services/jobs.js';
import { seedIfEmpty } from './services/seed.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Render / most PaaS hosts sit behind one reverse proxy; needed for correct client IPs in rate limiting
app.set('trust proxy', 1);

// Global rate limiting (Increased to 1000 to accommodate dashboard 10s auto-polling)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// CORS: same-origin in the single-service deployment; set CORS_ORIGIN (comma-separated) to allow other origins
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);

app.use('/api', limiter);
app.use(cors(corsOrigins?.length ? { origin: corsOrigins } : undefined));
app.use(express.json());

// Register API Routes
app.use('/api/auth', authRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/docks', dockRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/demo', demoRoutes);

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Unknown API routes → JSON 404 (instead of falling through to the SPA)
app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Serve the built React client when it exists (single-service deployment)
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  logger.info(`Serving client from ${clientDist}`);
}

// Error handling middleware
app.use(errorHandler);

// Start Server once the database is reachable
connectDB().then(async () => {
  try {
    await seedIfEmpty();
  } catch (error) {
    logger.error(`[SEED] Failed: ${(error as Error).message}`);
  }
  startJobs();
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
});
