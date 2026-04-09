# 🚖 Dispatch System — Phase 1

TfL Licensed Private Hire Dispatch Platform — Backend API + Admin Control Panel

---

## Project Structure

```
dispatch-system/
├── docker-compose.yml        # PostgreSQL + Redis
├── backend/                  # Fastify API (Node.js + TypeScript)
│   ├── prisma/
│   │   └── schema.prisma     # Full database schema
│   └── src/
│       ├── server.ts         # Entry point
│       ├── config.ts         # Environment config
│       ├── plugins/          # Fastify plugins
│       │   ├── auth.ts       # JWT authentication
│       │   ├── database.ts   # Prisma client
│       │   ├── redis.ts      # Redis + key helpers
│       │   └── socket.ts     # Socket.io real-time
│       ├── routes/
│       │   ├── auth.ts       # OTP login, JWT, admin login
│       │   ├── bookings.ts   # Full booking lifecycle
│       │   ├── drivers.ts    # Driver management + dispatch
│       │   └── admin.ts      # Dashboard, reports, corporate
│       ├── services/
│       │   ├── dispatch.service.ts   # Auto-dispatch engine
│       │   ├── pricing.service.ts    # Fare calculation
│       │   └── maps.service.ts       # Google Maps API
│       └── types/
│           └── index.ts      # Shared types + socket events
└── admin/                    # Next.js Admin Panel
    └── src/
        ├── app/
        │   ├── login/        # Admin login page
        │   └── (admin)/      # Protected admin pages
        │       ├── page.tsx          # Dashboard
        │       ├── dispatch/         # Live dispatch map
        │       ├── bookings/         # Booking management
        │       ├── drivers/          # Driver management
        │       ├── customers/        # Passenger list
        │       ├── corporate/        # Corporate accounts
        │       ├── reports/          # Revenue charts
        │       ├── documents/        # TfL doc review
        │       ├── alerts/           # Compliance alerts
        │       └── settings/         # System settings
        ├── components/
        │   ├── Sidebar.tsx           # Navigation
        │   └── ui/index.tsx          # Shared UI components
        └── lib/
            ├── api.ts                # Axios client + auth store
            └── socket.ts             # Socket.io client
```

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker (for PostgreSQL + Redis)
- A Google Maps API key
- A Stripe account (for payment processing)

### 2. Start infrastructure

```bash
docker-compose up -d
```

This starts PostgreSQL on port 5432 and Redis on port 6379.

### 3. Set up Backend

```bash
cd backend
cp .env.example .env
# Fill in your keys in .env

npm install
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Run migrations
npm run db:seed          # Create admin user + pricing zones
npm run dev              # Start API on http://localhost:3001
```

### 4. Set up Admin Panel

```bash
cd admin
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1

npm install
npm run dev              # Start admin on http://localhost:3000
```

### 5. Login

Open http://localhost:3000 and sign in with:
- **Email:** admin@dispatch.com
- **Password:** Admin1234!

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/otp/send` | Send OTP to phone |
| POST | `/api/v1/auth/otp/verify` | Verify OTP, get JWT |
| POST | `/api/v1/auth/admin/login` | Admin email+password login |
| POST | `/api/v1/auth/refresh` | Refresh JWT token |
| GET  | `/api/v1/auth/me` | Get current user |

### Bookings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/bookings/quote` | None | Get fare estimate |
| POST | `/api/v1/bookings` | Passenger | Create booking |
| GET  | `/api/v1/bookings/:id` | Any | Get booking details |
| GET  | `/api/v1/bookings/my` | Passenger | My booking history |
| PATCH | `/api/v1/bookings/:id/cancel` | Any | Cancel booking |
| GET  | `/api/v1/admin/bookings` | Admin | All bookings |
| POST | `/api/v1/admin/bookings` | Admin | Create booking for passenger |
| POST | `/api/v1/admin/bookings/:id/dispatch` | Admin | Manually assign driver |

### Drivers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/drivers/location` | Driver | Update GPS location |
| PATCH | `/api/v1/drivers/status` | Driver | Go online/offline/break |
| POST | `/api/v1/drivers/jobs/:id/accept` | Driver | Accept job offer |
| POST | `/api/v1/drivers/jobs/:id/reject` | Driver | Reject job offer |
| PATCH | `/api/v1/drivers/jobs/:id/status` | Driver | Update job status |
| GET  | `/api/v1/drivers/earnings` | Driver | Earnings summary |
| GET  | `/api/v1/drivers/jobs` | Driver | Job history |
| GET  | `/api/v1/admin/drivers` | Admin | All drivers |
| PATCH | `/api/v1/admin/drivers/:id/documents/:docId` | Admin | Approve/reject document |
| GET  | `/api/v1/admin/drivers/documents/expiring` | Admin | Expiring document alerts |

### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/v1/admin/dashboard` | Admin | Dashboard stats |
| GET  | `/api/v1/admin/reports/revenue` | Admin | Revenue report |
| GET  | `/api/v1/admin/corporate` | Admin | Corporate accounts |
| POST | `/api/v1/admin/corporate` | Admin | Create corporate account |
| PUT  | `/api/v1/admin/corporate/:id` | Admin | Update corporate account |
| GET  | `/api/v1/admin/map/drivers` | Admin | Live driver positions |
| GET  | `/api/v1/places/autocomplete` | Any | Address autocomplete |

---

## Real-Time Events (Socket.io)

### Client → Server
- `subscribe:booking` — Join a booking room for live updates
- `unsubscribe:booking` — Leave booking room
- `ping` — Heartbeat

### Server → Client (Drivers)
- `driver:job_offer` — New job offer (with 60s timeout)

### Server → Client (Passengers)
- `booking:status_update` — Booking status changed
- `booking:driver_location` — Driver GPS position
- `booking:cancelled` — Booking was cancelled

### Server → Client (Admin)
- `admin:booking_created` — New booking created
- `admin:booking_updated` — Booking updated
- `admin:driver_update` — Driver status or location changed

---

## Dispatch Flow

```
ASAP Booking Created
        ↓
Find nearest available drivers (haversine, within 10km)
        ↓
Offer job to Driver #1 (60s timeout)
        ↓ (accepted)          ↓ (rejected / timeout)
  Assign to Driver #1      Try Driver #2
  Notify passenger         (up to 3 attempts)
                                ↓ (all failed)
                         Escalate to manual dispatch
                         Alert admin dashboard
```

---

## Pricing Model

**Fixed pricing** (default):
```
Total = Base Fare + (Distance in miles × Per Mile Rate)
      + Airport supplement (if applicable)
      + Time supplement (night/weekend/bank holiday)
```

**Metered pricing:**
```
Total = Base Fare + (Distance × Rate) + (Duration in min × Per Minute Rate)
      + Supplements
```

**Driver earning:**
```
Net = Gross Fare × (1 - Platform Fee %)
Default platform fee: 15%
```

---

## TfL Compliance

Every completed booking generates a receipt containing:
- Operator name and TfL licence number
- Driver full name and PCO badge number
- Vehicle registration and description
- Pickup and dropoff addresses
- Trip distance and duration
- Itemised fare breakdown
- Payment method

Document alerts are generated automatically when:
- PCO licence expires within 60 days
- Vehicle MOT expires within 30 days
- Insurance expires within 30 days

---

## Phase 2 — Coming Next

- **Driver App** (React Native/Expo) — Accept jobs, navigate, earnings
- **Passenger App** (React Native/Expo) — Book, track, pay
- **Stripe payment integration** — Card charging, Apple Pay, Google Pay
- **Twilio SMS** — OTP delivery, booking confirmations
- **Firebase FCM** — Push notifications
- **Google Maps** — Full map integration in admin dispatch

---

## Environment Variables

See `backend/.env.example` and `admin/.env.example` for all required variables.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Strong random string (use `openssl rand -hex 64`)
- `GOOGLE_MAPS_API_KEY` — Maps, Directions, Places APIs enabled
- `STRIPE_SECRET_KEY` — From your Stripe dashboard
- `TWILIO_*` — From your Twilio console
- `FIREBASE_*` — From Firebase Admin SDK credentials
