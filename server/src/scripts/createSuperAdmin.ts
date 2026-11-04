/**
 * Creates a SUPER_ADMIN account (refuses if the email or username is taken).
 * Super admins can no longer be registered through the public API.
 *
 * Usage (credentials come from env vars so the password never lands in shell history as an argument):
 *   SUPER_ADMIN_USERNAME=root SUPER_ADMIN_EMAIL=root@example.com SUPER_ADMIN_PASSWORD=... npm run create-super-admin
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

dotenv.config();

async function main() {
  const { MONGO_URI, SUPER_ADMIN_USERNAME, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } = process.env;

  if (!MONGO_URI) throw new Error('MONGO_URI is not set');
  if (!SUPER_ADMIN_USERNAME || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    throw new Error('Set SUPER_ADMIN_USERNAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD');
  }
  if (SUPER_ADMIN_PASSWORD.length < 12) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters');
  }

  await mongoose.connect(MONGO_URI);

  const email = SUPER_ADMIN_EMAIL.toLowerCase().trim();
  const existing = await User.findOne({ $or: [{ email }, { username: SUPER_ADMIN_USERNAME }] });
  if (existing) {
    throw new Error(`A user with that email or username already exists (role: ${existing.role})`);
  }

  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
  const user = await User.create({
    username: SUPER_ADMIN_USERNAME,
    email,
    passwordHash,
    role: 'SUPER_ADMIN',
    status: 'APPROVED',
  });

  console.log(`Super admin created: ${user.username} <${user.email}> (${user._id})`);
}

main()
  .catch((err) => {
    console.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
