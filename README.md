# SmartDock

SmartDock is a multi-tenant industrial dock scheduling system designed to optimize logistics and prevent double-bookings. Built with a MERN stack in TypeScript, it enforces tenant isolation, handles dynamic operating schedules across different timezones, and guarantees double-booking prevention at the database layer.

---

## 🏗️ System Architecture

SmartDock is built following a strict layered architecture:

```
[ Presentation Layer: React + Vite + Tailwind CSS ]
                        │
                        ▼
[ Security & Middleware: JWT Auth, Role-Based Access Control (RBAC) ]
                        │
                        ▼
[ Controller / Service Layer: Business rules, Availability slot math ]
                        │
                        ▼
[ Data Access Layer: Mongoose Schemas, Strict Validation, DB Indexes ]
```

### Key Technical Details
1. **Layered Decoupling**: Middleware validates tokens and checks authorization first. Business logic calculates available hours. Mongoose schemas validate data formats before commits occur.
2. **Tenant Isolation**:
   - Carriers/Vendors can only read and write bookings belonging to their own user ID (`vendorId`).
   - **Per-warehouse vendor access**: at sign-up a vendor picks the warehouses they want to work with, which creates one `VendorAccess` request per warehouse. Each warehouse admin sees and decides only the requests for their own warehouse, and a vendor can view availability and book only where their access is `APPROVED`. Vendors can request more warehouses from their dashboard.
   - `SUPER_ADMIN` accounts cannot be registered through the API. Create one on the server with `npm run create-super-admin` (see below).
   - Warehouse Admins can only view and mutate docks, operating schedules, and bookings scoped to their assigned `warehouseId`.
   - The API extracts these identifiers directly from validated JWT claims—never trusting client input.

---

## 🔒 Atomic Double-Booking Guarantee

Each dock has a `maxCapacityPerHour`. A booking must exactly match one of the warehouse's slots (aligned to the slot grid and inside operating hours), and a slot never holds more active bookings than that capacity, even when requests arrive at the same moment on different server instances.

- **Dock write lock inside a MongoDB transaction**: every booking transaction first increments `bookingLockVersion` on the dock document, then counts the overlapping active bookings and inserts only if there is room. Because concurrent transactions write the same dock document, MongoDB aborts all but one with a write conflict, and `withTransaction` retries them so they see the committed booking. A plain "check for overlap, then insert" inside a transaction is *not* enough: each transaction reads its own snapshot and both commit.
- **In-process lock**: requests for the same dock are also serialized inside each Node process. On a standalone MongoDB (no replica set, so no transactions) this is the only protection, which is safe for a single local dev server but **not** for multiple instances. Use a replica set (MongoDB Atlas is one) in production. The server logs a warning when it falls back.
- **Booking lifecycle**: `PENDING → APPROVED | REJECTED | CANCELLED`, `APPROVED → IN_PROGRESS | CANCELLED`, `IN_PROGRESS → COMPLETED | CANCELLED`. `COMPLETED`, `CANCELLED` and `REJECTED` are terminal, so a freed slot can't be re-occupied by reviving an old booking. Vendors may cancel only `PENDING` or `APPROVED` bookings.
- **UX Rollback Handling**: if a slot fills up first (`409 Conflict`), the client-side wizard warns the user, immediately re-polls the updated slot availability, and returns them to the slot picker without wiping their driver/truck form details.
- **Verification**: `npm run verify:critical` (in `server/`) starts a throwaway in-memory replica set and two API instances, then fires 40 concurrent booking requests at capacity-1 and capacity-3 slots and checks that exactly 1 and 3 succeed. It also checks vendor access isolation, slot validation and the status lifecycle.

---

## ⏰ Timezone & UTC Time Strategy

- **UTC Storage**: All booking times (`startTime`, `endTime`) are validated, converted, and stored as UTC dates in MongoDB.
- **Operating Hours**: Warehouses specify operating hours (e.g. `08:00` - `17:00`) along with a local timezone descriptor (e.g. `America/New_York`).
- **Availability Math**: The server converts local operating hours to exact UTC bounds matching the warehouse timezone (correctly handling local daylight saving offsets) to search for overlaps.
- **Display Layer**: The browser receives UTC ISO datetime strings and parses them to localized display strings (e.g. `08:00 AM`) in the browser's local timezone using `date-fns`.

---

## 🚀 Deployment Instructions

### 1. Server Deployment (Render)
Render is ideal for hosting Node.js Express APIs.

1. **Create Web Service**: Connect your GitHub repository to Render and create a new **Web Service**.
2. **Configure Build Settings**:
   - **Root Directory**: `server`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `node dist/server.js`
3. **Configure Environment Variables**:
   - `PORT`: `5000` (or leave default)
   - `NODE_ENV`: `production`
   - `MONGO_URI`: Your MongoDB Atlas production connection string.
   - `JWT_SECRET`: A secure, random secret key.
4. **Deploy**: Trigger manual deploy or setup auto-deploys on commit.
5. **Create a super admin** (optional, one-off), from a shell with the production `MONGO_URI`:
   ```bash
   SUPER_ADMIN_USERNAME=root SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='<12+ chars>' npm run create-super-admin
   ```
6. **Upgrading an existing database** to per-warehouse vendor access (one-off, safe to re-run):
   ```bash
   npm run migrate:vendor-access -- --dry-run
   npm run migrate:vendor-access              # approved vendors keep access where they already have bookings
   npm run migrate:vendor-access -- --grant-all  # or: approve them at every warehouse (old behaviour)
   ```
   Pending vendors become active accounts with no warehouse access yet; they request warehouses from their dashboard.

### 2. Client Deployment (Vercel)
Vercel is optimized for building and deploying static React/Vite frontends.

1. **Create Project**: Connect your GitHub repository to Vercel and create a new project.
2. **Configure Framework Preset**: Select **Vite**.
3. **Configure Directory Settings**:
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. **Configure Environment Variables**:
   - `VITE_API_URL`: The deployment URL of your Render server (e.g. `https://smartdock-api.onrender.com`).
5. **Configure Router Rewrites**: Create a `/client/vercel.json` file to support client-side React routing:
   ```json
   {
     "rewrites": [
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```
6. **Deploy**: Click **Deploy**. Vercel will build the assets and host them globally.
