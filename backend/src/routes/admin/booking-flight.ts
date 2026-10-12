// backend/src/routes/admin/booking-flight.ts
//
// Step 6a — admin flight actions:
//   POST /admin/bookings/:id/confirm-earlier  { pickupTime: "HH:MM" (UK) }
//        → confirmEarlierPickup (sets current + booked pickup, EARLIER_CONFIRMED,
//          passenger SMS, driver push)
//   GET  /admin/flight-alerts
//        → unverified flights + bookings where an earlier pickup is possible
//          (Alerts page; computed on the fly, no alert table)
import { FastifyInstance } from "fastify";
import { BookingStatus } from "@prisma/client";
import {
  confirmEarlierPickup,
  earliestPickupAt,
} from "../../services/flightUpdate.service";

const STARTED: BookingStatus[] = [
  BookingStatus.DRIVER_ARRIVED,
  BookingStatus.IN_PROGRESS,
];
const FINISHED: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
];
const UNVERIFIED_KEEP_H = 12; // show unverified flights until 12h after the watch ended

const passengerSelect = {
  select: {
    user: { select: { firstName: true, lastName: true, phone: true } },
  },
};

export async function adminBookingFlightRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/admin/bookings/:id/confirm-earlier",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { pickupTime } = (request.body ?? {}) as { pickupTime?: string };
      if (!pickupTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime)) {
        return reply
          .status(400)
          .send({ success: false, error: "Enter the time as HH:MM" });
      }

      const admin = await fastify.prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { firstName: true, lastName: true },
      });
      const name =
        `${admin?.firstName ?? ""} ${admin?.lastName ?? ""}`.trim() || "admin";

      const result = await confirmEarlierPickup(
        fastify.prisma,
        fastify.redis,
        id,
        pickupTime,
        name,
        { io: fastify.io as any }
      );
      if (!result.ok) {
        return reply
          .status(result.status)
          .send({ success: false, error: result.error });
      }
      fastify.log.warn(
        `[FlightAdmin] ${id}: earlier pickup ${pickupTime} confirmed by ${name} (sms ${result.smsSent}, push ${result.pushSent})`
      );
      return reply.send({ success: true, data: result });
    }
  );

  fastify.get(
    "/admin/flight-alerts",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const now = new Date();
      const since = new Date(now.getTime() - UNVERIFIED_KEEP_H * 3600_000);

      const [watches, candidates] = await Promise.all([
        fastify.prisma.flightWatch.findMany({
          where: {
            unverified: true,
            OR: [{ endedAt: null }, { endedAt: { gte: since } }],
          },
          select: {
            id: true,
            flightNumber: true,
            arrivalDate: true,
            expectedGateArrivalAt: true,
            lastCheckedAt: true,
            bookings: {
              where: { status: { notIn: FINISHED } },
              select: {
                id: true,
                reference: true,
                scheduledAt: true,
                passenger: passengerSelect,
              },
            },
          },
          orderBy: { expectedGateArrivalAt: "asc" },
        }),
        fastify.prisma.booking.findMany({
          where: {
            status: { notIn: [...FINISHED, ...STARTED] },
            scheduledAt: { gt: now },
            flightWatch: { is: { status: { in: ["WATCHING", "ARRIVED"] } } },
          },
          select: {
            id: true,
            reference: true,
            status: true,
            flightNumber: true,
            scheduledAt: true,
            pickupOffsetMinutes: true,
            passenger: passengerSelect,
            flightWatch: {
              select: {
                status: true,
                expectedGateArrivalAt: true,
                actualGateArrivalAt: true,
              },
            },
          },
          orderBy: { scheduledAt: "asc" },
        }),
      ]);

      const earlierPossible = candidates
        .map((b) => {
          const earliestAt = earliestPickupAt(b, b.flightWatch, now);
          return earliestAt
            ? {
                id: b.id,
                reference: b.reference,
                flightNumber: b.flightNumber,
                scheduledAt: b.scheduledAt,
                earliestAt,
                passenger: b.passenger,
              }
            : null;
        })
        .filter(Boolean);

      return reply.send({
        success: true,
        data: {
          unverified: watches.filter((w) => w.bookings.length > 0),
          earlierPossible,
        },
      });
    }
  );
}
