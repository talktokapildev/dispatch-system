// backend/src/routes/admin/booking-trip.ts
//
// Admin booking detail extras:
//   GET /admin/bookings/:id/trip  → trip timeline + which route the map shows
//   GET /admin/bookings/:id/map   → static map PNG (pickup, dropoff, route)
//
// Route choice:
//   COMPLETED with actualRoutePolyline → actual route (driver GPS, Phase 2)
//   everything else                    → estimated route (Google Directions)
// The estimated polyline is fetched once on first map view and stored on
// the booking, so historic bookings get a route without a backfill.
//
// The map is built server-side so the Google key never reaches the browser.
import { FastifyInstance } from "fastify";
import axios from "axios";
import { BookingStatus } from "@prisma/client";
import { MapsService } from "../../services/maps.service";
import { config } from "../../config";
import { fitPolyline } from "../../utils/polyline";

type RouteSource = "actual" | "estimated" | "none";

// Static Maps URLs are capped at 16,384 chars; keep the path well inside it
// (encoded polylines grow further once URL-encoded).
const MAX_POLYLINE_CHARS = 6000;

const COLOR_ACTUAL = "0xF97316ff"; // brand orange
const COLOR_ESTIMATED = "0x2563EBcc"; // blue, slightly transparent

function routeSourceFor(b: {
  status: BookingStatus;
  actualRoutePolyline: string | null;
}): RouteSource {
  if (b.status === BookingStatus.COMPLETED && b.actualRoutePolyline)
    return "actual";
  return "estimated";
}

// stops is Json — accept {latitude, longitude} or {lat, lng} shapes, skip anything else.
function stopsToWaypoints(stops: unknown): { lat: number; lng: number }[] {
  if (!Array.isArray(stops)) return [];
  return stops
    .map((s: any) => ({
      lat: s?.latitude ?? s?.lat,
      lng: s?.longitude ?? s?.lng,
    }))
    .filter((w) => typeof w.lat === "number" && typeof w.lng === "number");
}

export async function adminBookingTripRoutes(fastify: FastifyInstance) {
  // ─── Trip timeline ───
  fastify.get(
    "/admin/bookings/:id/trip",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        select: {
          status: true,
          createdAt: true,
          scheduledAt: true,
          claimedAt: true,
          dispatchedAt: true,
          driverAcceptedAt: true,
          driverArrivedAt: true,
          tripStartedAt: true,
          completedAt: true,
          actualDistance: true,
          actualDuration: true,
          actualRoutePolyline: true,
          statusHistory: {
            where: {
              status: { in: [BookingStatus.CANCELLED, BookingStatus.NO_SHOW] },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true, createdAt: true },
          },
        },
      });

      if (!booking) {
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      }

      const ended = booking.statusHistory[0];
      const events: { key: string; label: string; at: Date | null }[] = [
        { key: "booked", label: "Booked", at: booking.createdAt },
        {
          key: "claimed",
          label: "Claimed from job board",
          at: booking.claimedAt,
        },
        { key: "dispatched", label: "Dispatched", at: booking.dispatchedAt },
        {
          key: "accepted",
          label: "Driver accepted",
          at: booking.driverAcceptedAt,
        },
        {
          key: "arrived",
          label: "Driver arrived",
          at: booking.driverArrivedAt,
        },
        { key: "started", label: "Trip started", at: booking.tripStartedAt },
        { key: "completed", label: "Completed", at: booking.completedAt },
        {
          key: "ended",
          label:
            ended?.status === BookingStatus.NO_SHOW ? "No show" : "Cancelled",
          at: ended?.createdAt ?? null,
        },
      ];

      const tripMinutes =
        booking.tripStartedAt && booking.completedAt
          ? Math.round(
              (booking.completedAt.getTime() -
                booking.tripStartedAt.getTime()) /
                60000
            )
          : null;

      return reply.send({
        success: true,
        data: {
          scheduledAt: booking.scheduledAt,
          timeline: events.filter((e) => e.at !== null),
          tripMinutes,
          actualDistanceMiles: booking.actualDistance,
          actualDurationMinutes: booking.actualDuration,
          routeSource: routeSourceFor(booking),
        },
      });
    }
  );

  // ─── Static map image ───
  fastify.get(
    "/admin/bookings/:id/map",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const booking = await fastify.prisma.booking.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          pickupLatitude: true,
          pickupLongitude: true,
          dropoffLatitude: true,
          dropoffLongitude: true,
          stops: true,
          estimatedRoutePolyline: true,
          actualRoutePolyline: true,
        },
      });

      if (!booking) {
        return reply
          .status(404)
          .send({ success: false, error: "Booking not found" });
      }

      let source = routeSourceFor(booking);
      let polyline: string | null =
        source === "actual"
          ? booking.actualRoutePolyline
          : booking.estimatedRoutePolyline;

      // Lazily fetch and store the estimated route on first view.
      if (source === "estimated" && !polyline) {
        try {
          const maps = new MapsService();
          const directions = await maps.getDirections(
            { lat: booking.pickupLatitude, lng: booking.pickupLongitude },
            { lat: booking.dropoffLatitude, lng: booking.dropoffLongitude },
            stopsToWaypoints(booking.stops)
          );
          polyline = directions.polyline;
          await fastify.prisma.booking.update({
            where: { id: booking.id },
            data: { estimatedRoutePolyline: polyline },
          });
        } catch (err) {
          // Still render pickup/dropoff markers without a route.
          request.log.warn(
            { err, bookingId: booking.id },
            "Directions failed for booking map"
          );
          source = "none";
          polyline = null;
        }
      }

      const params: string[] = [
        "size=640x320",
        "scale=2",
        "maptype=roadmap",
        `markers=${encodeURIComponent(
          `color:green|label:P|${booking.pickupLatitude},${booking.pickupLongitude}`
        )}`,
        `markers=${encodeURIComponent(
          `color:red|label:D|${booking.dropoffLatitude},${booking.dropoffLongitude}`
        )}`,
      ];
      if (polyline) {
        const color = source === "actual" ? COLOR_ACTUAL : COLOR_ESTIMATED;
        const path = `color:${color}|weight:5|enc:${fitPolyline(
          polyline,
          MAX_POLYLINE_CHARS
        )}`;
        params.push(`path=${encodeURIComponent(path)}`);
      }
      params.push(`key=${config.GOOGLE_MAPS_API_KEY}`);

      try {
        const { data } = await axios.get(
          `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}`,
          { responseType: "arraybuffer" }
        );
        return reply
          .header("Content-Type", "image/png")
          .header("Cache-Control", "private, max-age=3600")
          .header("X-Route-Source", source)
          .send(Buffer.from(data));
      } catch (err) {
        request.log.error(
          { err, bookingId: booking.id },
          "Static map fetch failed"
        );
        return reply
          .status(502)
          .send({ success: false, error: "Map unavailable" });
      }
    }
  );
}
