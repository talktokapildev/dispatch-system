// backend/src/routes/scheduledBooking.routes.ts
//
// Job board endpoints for scheduled (advance) bookings: list open jobs,
// claim, and release. Follows the same shape as bookings.ts — plain
// Fastify route functions, Zod validation, fastify.authenticate preHandler.
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { MapsService } from "../services/maps.service";
import { ScheduledBookingService } from "../services/scheduledBooking.service";
import {
  buildDriverFlightView,
  driverFlightSelect,
} from "../services/driverFlightView";
import { jobDistances, parseCoords } from "../services/jobDistance.service";
import type { Booking } from "@prisma/client";

const claimSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export async function scheduledBookingRoutes(fastify: FastifyInstance) {
  const maps = new MapsService();
  const scheduledBookings = new ScheduledBookingService(
    fastify.prisma,
    fastify.redis,
    fastify.io,
    maps
  );

  // Job board cards: flight chip (airport jobs) + distances
  // (?lat=&lng= = driver's current location, optional). Raw provider snapshot
  // is not sent to the app.
  async function decorate(jobs: Booking[], query: unknown) {
    const flightRows = await fastify.prisma.booking.findMany({
      where: {
        id: { in: jobs.filter((j) => j.flightNumber).map((j) => j.id) },
      },
      select: driverFlightSelect,
    });
    const flights = new Map(
      flightRows.map((r) => [r.id, buildDriverFlightView(r)])
    );
    const distances = await jobDistances(
      fastify.redis,
      jobs,
      parseCoords((query ?? {}) as { lat?: string; lng?: string }),
      maps
    );
    return jobs.map(({ flightSnapshot: _snap, ...j }) => ({
      ...j,
      flight: flights.get(j.id) ?? null,
      distance: distances.get(j.id) ?? null,
    }));
  }

  // ─── List open jobs (driver job board) ───
  fastify.get(
    "/bookings/scheduled/open",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) {
        return reply
          .status(403)
          .send({ success: false, error: "Driver account required" });
      }

      const jobs = await scheduledBookings.listOpenJobs();
      return reply.send({
        success: true,
        data: await decorate(jobs, request.query),
      });
    }
  );

  // ─── List jobs I've claimed (not yet started) ───
  fastify.get(
    "/bookings/scheduled/mine",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) {
        return reply
          .status(403)
          .send({ success: false, error: "Driver account required" });
      }

      const jobs = await scheduledBookings.listClaimedByDriver(driver.id);
      const jobsWithCanStart = (await decorate(jobs, request.query)).map(
        (j) => ({
          ...j,
          canStart: ScheduledBookingService.canStartNow(j.scheduledAt),
        })
      );
      return reply.send({ success: true, data: jobsWithCanStart });
    }
  );

  // ─── Claim a job ───
  fastify.post(
    "/bookings/:id/claim",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { userId } = request.user;
      const body = claimSchema.parse(request.body);

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) {
        return reply
          .status(403)
          .send({ success: false, error: "Driver account required" });
      }

      const result = await scheduledBookings.claimJob(
        id,
        driver.id,
        userId,
        body.latitude,
        body.longitude
      );

      if (!result.success) {
        const statusMap: Record<string, number> = {
          not_found: 404,
          already_claimed: 409,
          lock_contended: 409,
          eta_infeasible: 422,
        };
        return reply.status(statusMap[result.reason] ?? 400).send({
          success: false,
          error: result.reason,
          etaMinutes: "etaMinutes" in result ? result.etaMinutes : undefined,
        });
      }

      return reply.send({ success: true, data: result.booking });
    }
  );

  // ─── Release a claimed job back to the pool ───
  fastify.post(
    "/bookings/:id/release",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) {
        return reply
          .status(403)
          .send({ success: false, error: "Driver account required" });
      }

      const result = await scheduledBookings.releaseJob(id, driver.id);

      if (!result.success) {
        const statusMap: Record<string, number> = {
          not_found: 404,
          not_your_booking: 403,
          not_claimable_state: 409,
        };
        return reply.status(statusMap[result.reason] ?? 400).send({
          success: false,
          error: result.reason,
        });
      }

      return reply.send({
        success: true,
        data: { adminAlertRequired: result.adminAlertRequired },
      });
    }
  );

  // ─── Start a claimed job (transition into live trip flow) ───
  fastify.post(
    "/bookings/:id/start",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { userId } = request.user;

      const driver = await fastify.prisma.driver.findUnique({
        where: { userId },
      });
      if (!driver) {
        return reply
          .status(403)
          .send({ success: false, error: "Driver account required" });
      }

      const result = await scheduledBookings.startClaimedJob(id, driver.id);

      if (!result.success) {
        const statusMap: Record<string, number> = {
          not_found: 404,
          not_your_booking: 403,
          not_startable_state: 409,
          too_early: 422,
        };
        const messages: Record<string, string> = {
          too_early:
            "You can't start this trip yet — it's outside the start window.",
        };
        return reply.status(statusMap[result.reason] ?? 400).send({
          success: false,
          error: messages[result.reason] ?? result.reason,
        });
      }

      return reply.send({ success: true, data: result.booking });
    }
  );
}
