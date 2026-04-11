# Passenger App — Backend Endpoints Required
# Add these to your Fastify backend under /api/v1

# ─── AUTH (already exists — just need PASSENGER role to work) ───────────────
#
# POST /auth/otp/send          ← already exists, shared with driver
# POST /auth/otp/verify        ← already exists; returns user.role = 'PASSENGER'
# GET  /auth/me                ← already exists; must return passenger: { id, userId, ... }
#                                 on the meRes.data.data object when role = PASSENGER

# ─── FARE ESTIMATE (new) ────────────────────────────────────────────────────
#
# GET  /bookings/estimate
#   Query: pickupLat, pickupLng, dropoffLat, dropoffLng
#   Response: { data: { estimatedFare: number, distanceKm: number, durationMins: number, polyline?: string } }
#   Logic: call /maps/directions internally, apply your rate card to get fare

# ─── PASSENGER BOOKINGS (new route group) ───────────────────────────────────
#
# POST /passengers/bookings
#   Body: { pickupAddress, pickupLatitude, pickupLongitude,
#           dropoffAddress, dropoffLatitude, dropoffLongitude, passengerCount }
#   Auth: Bearer token, role = PASSENGER
#   Creates a Booking record, links to the authenticated Passenger
#   Response: { data: booking }
#
# GET  /passengers/bookings
#   Auth: Bearer token, role = PASSENGER
#   Query: page, limit
#   Returns bookings for the authenticated passenger (newest first)
#   Response: { data: { items: booking[], total: number } }
#
# GET  /passengers/bookings/:id
#   Auth: Bearer token, role = PASSENGER (must own booking)
#   Returns full booking with:
#     - driver: { user: { firstName, lastName }, pcoBadgeNumber, rating,
#                 lastLatitude, lastLongitude,
#                 vehicle: { make, model, licensePlate, color } }
#   Response: { data: booking }
#
# PATCH /passengers/bookings/:id/cancel
#   Auth: Bearer token, role = PASSENGER (must own booking)
#   Only allowed when status is PENDING or CONFIRMED
#   Sets status = CANCELLED
#   Response: { data: booking }
#
# POST  /passengers/bookings/:id/rate
#   Auth: Bearer token, role = PASSENGER (must own booking)
#   Body: { rating: number }  (1–5)
#   Stores rating on the booking; updates driver.rating average
#   Response: { data: { ok: true } }

# ─── SOCKET EVENTS (emit from backend → passenger) ──────────────────────────
#
# When a driver accepts a job:
#   emit to room `passenger:{passengerId}`:
#     event: 'passenger:driver_assigned'
#     payload: { bookingId, driverName, vehiclePlate }
#
# When driver location updates (POST /drivers/location):
#   emit to room `passenger:{passengerId}` IF booking is active:
#     event: 'passenger:driver_location'
#     payload: { bookingId, latitude, longitude }
#
# When booking status changes (PATCH /drivers/jobs/:id/status):
#   emit to room `passenger:{passengerId}`:
#     event: 'passenger:status_update'
#     payload: { bookingId, status }

# ─── PASSENGER SOCKET ROOM ──────────────────────────────────────────────────
#
# In your socket auth middleware, when role = PASSENGER:
#   socket.join(`passenger:${passenger.id}`)   ← Passenger table id (not User id)
#   (same pattern as driver:${userId} for drivers)

# ─── NOTES ──────────────────────────────────────────────────────────────────
#
# - The GET /auth/me endpoint needs a branch: if user.role === 'PASSENGER',
#   include passenger: await prisma.passenger.findUnique({ where: { userId: user.id }, include: { ... } })
#
# - Passenger creation: passengers self-register via OTP. On first verify,
#   if no Passenger record exists for that userId, create one automatically.
#
# - Booking ownership check: always verify booking.passenger.userId === req.user.id
