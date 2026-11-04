/**
 * Local demo without installing MongoDB: starts an in-memory replica set, seeds the demo data
 * and runs the API (which also serves client/dist if it has been built).
 *
 *   npm run dev:demo            → http://localhost:5000
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Reuse the binary cached under server/node_modules regardless of the working directory
process.env.MONGOMS_DOWNLOAD_DIR ??= path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/.cache/mongodb-memory-server'
);

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.MONGO_URI = replSet.getUri('smartdock_demo');
process.env.SEED_DEMO = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'local_demo_secret';
process.env.PORT = process.env.PORT || '5000';

console.log(`In-memory MongoDB replica set ready. Starting SmartDock on http://localhost:${process.env.PORT} ...`);

const shutdown = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await import('../server.js');
