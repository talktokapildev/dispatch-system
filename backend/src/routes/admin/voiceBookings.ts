// backend/src/routes/admin/voiceBookings.ts
//
// Bookings taken by Araa (the AI phone receptionist) wait on hold for Kapil:
//   POST /admin/bookings/:id/approve-request            → off hold; job board (2h+ notice) or
//                                                          CONFIRMED to dispatch; texts the passenger
//   POST /admin/bookings/:id/decline-request {reason?}  → CANCELLED; texts the passenger
//   GET  /admin/voice-calls?limit=                      → recent calls (for the Calls page)
// Approving records the admin as the dispatcher (TfL: acceptance stays with the operator).
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ScheduledBookingService } from "../../services/scheduledBooking.service";
import { sendSms } from "../../services/sms.service";
import { money, ukShort } from "../../services/voiceAgentRules";

const declineSchema = z.object({ reason: z.string().max(300).optional() });

export async function adminVoiceBookingRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };

  const loadRequest = async (id: string) =>
    fastify.prisma.booking.findUnique({
      where: { id },
      include: { passenger: { include: { user: true } }, voiceCall: { select: { id: true } } },
    });

  fastify.post("/admin/bookings/:id/approve-request", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = await loadRequest(id);
    if (!b) return reply.status(404).send({ success: false, error: "Booking not found" });
    if (!b.isOnHold || b.status !== "CONFIRMED")
      return reply.status(400).send({ success: false, error: "This booking isn't waiting for approval." });

    const onBoard = !!b.scheduledAt && ScheduledBookingService.hasMinimumLeadTime(b.scheduledAt);
    const status = onBoard ? "SCHEDULED_OPEN" : "CONFIRMED";
    const adminUserId = request.user.userId;
    const [updated] = await fastify.prisma.$transaction([
      fastify.prisma.booking.update({
        where: { id },
        data: { isOnHold: false, status, dispatchedBy: adminUserId, dispatchedAt: new Date() },
      }),
      fastify.prisma.bookingStatusHistory.create({
        data: { bookingId: id, status, note: `Phone request approved${onBoard ? "; on the job board" : ""}` },
      }),
    ]);
    fastify.io.to("admin").emit("admin:booking:updated", { bookingId: id, status });

    const phone = b.passenger?.user?.phone;
    let texted = false;
    if (phone && b.scheduledAt) {
      const first = b.passenger?.user?.firstName && !/^unknown$/i.test(b.passenger.user.firstName) ? `Hi ${b.passenger.user.firstName}, ` : "Hi, ";
      const r: any = await sendSms(
        phone,
        `${first}your OrangeRide booking is confirmed: ${ukShort(b.scheduledAt)}, ${b.pickupAddress} → ${b.dropoffAddress}, ${money(b.estimatedFare)}. Ref ${b.reference}. We'll text your driver's details before pickup.`,
        { purpose: "OTHER", bookingId: id }
      ).catch(() => ({ ok: false }));
      texted = !!r?.ok;
    }
    return reply.send({ success: true, data: { booking: updated, texted } });
  });

  fastify.post("/admin/bookings/:id/decline-request", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = declineSchema.parse(request.body ?? {});
    const b = await loadRequest(id);
    if (!b) return reply.status(404).send({ success: false, error: "Booking not found" });
    if (!b.isOnHold || b.status !== "CONFIRMED")
      return reply.status(400).send({ success: false, error: "This booking isn't waiting for approval." });

    const note = `Phone request declined${reason ? `: ${reason}` : ""}`;
    const [updated] = await fastify.prisma.$transaction([
      fastify.prisma.booking.update({
        where: { id },
        data: { isOnHold: false, status: "CANCELLED", cancellationReason: note },
      }),
      fastify.prisma.bookingStatusHistory.create({ data: { bookingId: id, status: "CANCELLED", note } }),
    ]);
    fastify.io.to("admin").emit("admin:booking:updated", { bookingId: id, status: "CANCELLED" });

    const phone = b.passenger?.user?.phone;
    let texted = false;
    if (phone && b.scheduledAt) {
      const r: any = await sendSms(
        phone,
        `Sorry, OrangeRide can't take your booking for ${ukShort(b.scheduledAt)} (${b.pickupAddress} → ${b.dropoffAddress}).${reason ? ` ${reason}` : ""} Please call 07398 341839 if we can help another time.`,
        { purpose: "OTHER", bookingId: id }
      ).catch(() => ({ ok: false }));
      texted = !!r?.ok;
    }
    return reply.send({ success: true, data: { booking: updated, texted } });
  });

  fastify.get("/admin/voice-calls", auth, async (request, reply) => {
    const { limit = "50" } = request.query as Record<string, string>;
    const items = await fastify.prisma.voiceCall.findMany({
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(parseInt(limit) || 50, 1), 200),
      include: { booking: { select: { id: true, reference: true, status: true, isOnHold: true } } },
    });
    return reply.send({ success: true, data: items });
  });
}
