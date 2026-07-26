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
   - Warehouse Admins can only view and mutate docks, operating schedules, and bookings scoped to their assigned `warehouseId`.
   - The API extracts these identifiers directly from validated JWT claims—never trusting client input.

---

## 🔒 Atomic Double-Booking Guarantee

To prevent race conditions where two carriers try to book the same dock slot concurrently, SmartDock enforces database-level validation:

- **MongoDB Transactions**: Standard requests run within a transaction session (`session.withTransaction`). It checks for overlaps (`startTime < booking.endTime` AND `endTime > booking.startTime`) and blocks execution, throwing a conflict error if any are found before committing.
- **Graceful Standalone Fallback**: To support standalone local development databases (which do not support transactions without a configured replica set), the engine catches transaction errors and falls back to a query-check-save block.
- **UX Rollback Handling**: If a scheduling collision occurs (`409 Conflict`), the client-side wizard warns the user, immediately re-polls the updated timeslot availability, and returns them to the slot picker without wiping their driver/truck form details.

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
