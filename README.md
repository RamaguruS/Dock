# SmartDock — Dock Appointment Scheduling & Yard Management

SmartDock is a multi-tenant **dock appointment scheduling system** for warehouses and distribution centres (DCs) and the carriers that deliver to and collect from them. It replaces phone/email booking with a self-service portal, prevents dock double-booking, tracks every truck from gate to departure, and turns that data into operations KPIs (dock utilization, on-time arrival, turnaround time, carrier reliability).

Built with the MERN stack in TypeScript (MongoDB, Express, React, Node).

## 📦 Supply-chain problem it solves

Unplanned truck arrivals cause yard congestion, long driver wait (detention) times, idle dock labour and missed delivery windows. SmartDock applies **appointment-based dock scheduling**: carriers book a time slot at a compatible dock door, the warehouse confirms it, and the yard is run against that plan.

## ✨ Features

| Area | What it does |
|---|---|
| **Roles & tenancy** | Warehouse/DC managers own their site's docks, rules and data; carriers request access per warehouse and book only where approved; super admins are created from the server CLI only. |
| **Configurable scheduling** | Operating hours per weekday, slot length (15/30/60/90 min), turnover **buffer** between trucks, site timezone (DST-safe). |
| **Dock types** | Each dock door is inbound, outbound or both; supports specific trailer types (dry van, reefer, flatbed, container); optional **hazmat** certification. Carriers only see docks that can handle their load. |
| **Capacity & double-booking guarantee** | Each dock serves N trucks per slot; capacity is enforced atomically even across multiple server instances (MongoDB transaction + dock write lock). |
| **Blackouts & maintenance** | Holiday / shutdown dates close the whole site; per-dock maintenance windows block overlapping slots and list the appointments that need moving. |
| **Booking wizard** | Load details (inbound/outbound, trailer, hazmat) → dock & slot → truck, driver, PO/ASN, pallets → confirm. |
| **Recurring appointments** | "Every Tuesday 09:00 for 8 weeks" — each week booked only if free; skipped weeks reported; cancel the whole series in one click. |
| **Rescheduling** | Move an appointment to another slot/dock without cancel-and-rebook; history kept; a carrier move of a confirmed slot goes back for approval. |
| **Waitlist** | Join the waitlist for a full slot; when capacity frees up (cancel, reject, reschedule) the first compatible carrier is auto-assigned (FIFO) and notified. |
| **Yard execution** | Gate check-in → at dock → completed & departed, with timestamps; automatic **late** detection and **no-show** marking after a grace period; stale unapproved requests expire. |
| **Carrier scorecard** | Reliability score = (on-time + ½ × late) ÷ (arrivals + no-shows) × 100, tiers A–D, shown to managers when approving carriers. |
| **Analytics & KPIs** | Dock utilization, on-time rate, no-show & cancellation rate, gate-to-gate turnaround, yard wait, dock time, pallets handled, daily volume, weekday × hour demand heatmap, busiest hours, per-dock and per-carrier tables. |
| **Exports** | CSV and PDF (yard schedule, KPI report, scorecards, activity log) and a printable **daily gate sheet** for security staff. |
| **Audit trail** | Every change (who, what, when) stored in MongoDB and viewable/filterable in the UI, including automated actions. |
| **Notifications** | In-app notification centre for both sides; email via Resend and SMS to drivers via Twilio switch on automatically when API keys are configured. Reminders ~24 h before each confirmed appointment. |

## 🎬 Demo mode

With `SEED_DEMO=true` the server seeds two DCs (Chennai, Bengaluru), five typed docks, six carriers with different reliability profiles, ~5 weeks of history, a live "today" yard, upcoming bookings, a weekly series, a maintenance window and a waitlist.

| Account | Email | Password |
|---|---|---|
| Warehouse manager (Chennai DC) | `admin@smartdock.demo` | `Demo@123` |
| Carrier (Swift Freight Lines) | `carrier@smartdock.demo` | `Demo@123` |
| Carrier awaiting approval (Nova Movers) | `nova@smartdock.demo` | `Demo@123` |

Demo data is generated relative to the current time — press **Scheduling rules → Reset demo data** (as the warehouse manager) right before presenting. Reset wipes the whole database.

Run the whole thing locally without installing MongoDB:

```bash
cd client && npm install && npm run build
cd ../server && npm install && npm run dev:demo   # http://localhost:5000
```

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

## 🚀 Deployment (single Render web service + MongoDB Atlas)

The Express server also serves the built React app, so one service hosts everything.

1. **MongoDB Atlas**: create a free M0 cluster, a database user, allow network access from `0.0.0.0/0`, and copy the connection string (add `/smartdock` before the `?`). Atlas runs as a replica set, which the double-booking guarantee relies on.
2. **Render**: New → **Blueprint** → select this repository. `render.yaml` defines the service (build both apps, start `node dist/server.js`, health check `/health`, auto-deploy on push to `main`). Paste `MONGO_URI` when prompted; `JWT_SECRET` is generated.
3. Optional environment variables: `RESEND_API_KEY` + `EMAIL_FROM` (email), `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` (SMS), `SEED_DEMO` (`true` for the demo, `false` for real use), `CORS_ORIGIN` (only if the UI is hosted elsewhere).
4. Render's free tier sleeps after 15 minutes idle — open the site a minute before presenting.

**Create a super admin** (optional, one-off), from a shell with the production `MONGO_URI`:

```bash
SUPER_ADMIN_USERNAME=root SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='<12+ chars>' npm run create-super-admin
```

**Upgrading an existing database** to per-warehouse vendor access (one-off, safe to re-run):

```bash
npm run migrate:vendor-access -- --dry-run
```

## ✅ Verification

`npm run verify:critical` (in `server/`) starts a throwaway in-memory replica set and **two** API instances and runs 58 end-to-end checks: security fixes, concurrent booking capacity, slot rules, dock-type matching, maintenance, blackouts, recurring series, waitlist auto-assignment, rescheduling, gate events, reliability scores, audit isolation and analytics.
