// backend/src/routes/driverFlight.ts
//
// Phase 2b — driver flight endpoints (own jobs only):
//   GET  /drivers/jobs/:id/detail
//        → { job, flight }  job = the fields the job screens show (+ canStart),
//          flight = buildDriverFlightView (null if no flight)
//   POST /drivers/jobs/:id/confirm-earlier  { earliestAt: ISO }
//        → confirmEarlierPickup at the suggested earliest time (one tap).
//          earliestAt is the time the driver saw: if the flight moved since,
//          409 + the new time so the app can ask again.
import { FastifyInstance } from "fastify";
import { ScheduledBookingService } from "../services/scheduledBooking.service";
import {
  buildDriverFlightView,
  driverFlightSelect,
} from "../services/driverFlightView";
import { confirmEarlierPickup } from "../services/flightUpdate.service";
import { ukTime } from "../services/flightMessages";

const SAME_TIME_MS = 60_000;

export async function driverFlightRoutes(fastify: FastifyInstance) {
  async function ownJob(userId: string, id: string) {
    const driver = await fastify.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    });
    if (!driver) return { ok: false as const, error: 403 };
    const booking = await fastify.prisma.booking.findUnique({
      where: { id },
      select: {
        ...driverFlightSelect,
        driverId: true,
        reference: true,
        type: true,
        createdAt: true,
        pickupAddress: true,
        pickupLatitude: true,
        pickupLongitude: true,
        dropoffAddress: true,
        dropoffLatitude: true,
        dropoffLongitude: true,
        estimatedFare: true,
        actualFare: true,
        notes: true,
        terminal: true,
        passengerCount: true,
        claimedAt: true,
      },
    });
    if (!booking || booking.driverId !== driver.id)
      return { ok: false as const, error: 404 };
    return { ok: true as const, driver, booking };
  }

  fastify.get(
    "/drivers/jobs/:id/detail",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const r = await ownJob(request.user.userId, id);
      if (!r.ok)
        return reply
          .status(r.error)
          .send({ success: false, error: r.error === 403 ? "Driver account required" : "Job not found" });

      const {
        flightSnapshot: _snap,
        flightWatch: _w,
        flightEvents: _e,
        flightArrivalTime: _a,
        driverId: _d,
        ...job
      } = r.booking;
      return reply.send({
        success: true,
        data: {
          job: {
            ...job,
            canStart: ScheduledBookingService.canStartNow(job.scheduledAt),
          },
          flight: buildDriverFlightView(r.booking),
        },
      });
    }
  );

  fastify.post(
    "/drivers/jobs/:id/confirm-earlier",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { earliestAt } = (request.body ?? {}) as { earliestAt?: string };
      const r = await ownJob(request.user.userId, id);
      if (!r.ok)
        return reply.status(r.error).send({ success: false, error: "Job not found" });

      const view = buildDriverFlightView(r.booking);
      const current = view?.earlierPickup?.earliestAt;
      if (!current)
        return reply.status(400).send({
          success: false,
          error: "An earlier pickup isn't available any more",
        });
      const seen = earliestAt ? new Date(earliestAt).getTime() : NaN;
      if (!Number.isFinite(seen) || Math.abs(seen - new Date(current).getTime()) > SAME_TIME_MS)
        return reply.status(409).send({
          success: false,
          error: `The flight time changed - passenger can now be ready from ${ukTime(
            new Date(current)
          )}`,
          earliestAt: current,
        });

      const name =
        `${r.driver.user?.firstName ?? ""} ${r.driver.user?.lastName ?? ""}`.trim() ||
        "driver";
      const result = await confirmEarlierPickup(
        fastify.prisma,
        fastify.redis,
        id,
        ukTime(new Date(current)),
        `driver ${name}`,
        { io: fastify.io as any, byDriver: true }
      );
      if (!result.ok)
        return reply.status(result.status).send({ success: false, error: result.error });
      fastify.log.warn(
        `[FlightDriver] ${r.booking.reference}: earlier pickup ${ukTime(
          new Date(result.pickupAt)
        )} confirmed by driver ${name} (sms ${result.smsSent})`
      );
      return reply.send({ success: true, data: result });
    }
  );
}
