// backend/src/routes/scheduledBooking.routes.ts
//
// Job board endpoints for scheduled (advance) bookings: list open jobs,
// claim, and release. Follows the same shape as bookings.ts — plain
// Fastify route functions, Zod validation, fastify.authenticate preHandler.
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { MapsService } from "../services/maps.service";
import { ScheduledBookingService } from "../services/scheduledBooking.service";

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
      return reply.send({ success: true, data: jobs });
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
}
