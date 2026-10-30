// backend/src/routes/admin/voiceBookings.ts
//
// Bookings taken by Araa (the AI phone receptionist) wait on hold for Kapil:
//   POST /admin/bookings/:id/approve-request            → off hold; job board (2h+ notice) or
//                                                          CONFIRMED to dispatch; texts the passenger
//   POST /admin/bookings/:id/decline-request {reason?}  → CANCELLED; texts the passenger
//        { skipFlightCheck? }                           Airport pickups with a flight number: the
//                                                        flight is looked up first (as in the app) so
//                                                        tracking starts; a problem → 409 with the
//                                                        reason, approve again with skipFlightCheck.
//   GET  /admin/voice-calls?outcome=&limit=             → recent calls + how many wait for approval
//   GET  /admin/voice-calls/:id                         → one call with its transcript
//   GET  /admin/voice-agent/settings                    → Araa's settings (defaults filled in)
//   PUT  /admin/voice-agent/settings                    → change them (validated)
// Approving records the admin as the dispatcher (TfL: acceptance stays with the operator).
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ScheduledBookingService } from "../../services/scheduledBooking.service";
import { sendSms } from "../../services/sms.service";
import { resolveAirportPickup } from "../../services/airportBooking.service";
import { normalizePhone } from "../../lib/phone";
import { loadVoiceSettings } from "../../services/voiceAgent.service";
import { VOICES, VOICE_KEYS, money, parseHours, ukParts, ukShort } from "../../services/voiceAgentRules";

const declineSchema = z.object({ reason: z.string().max(300).optional() });
const approveSchema = z.object({ skipFlightCheck: z.boolean().optional() });
const settingsSchema = z.object({
  mode: z.enum(["ALWAYS", "HOURS", "OFF"]),
  hours: z.string().refine((h) => !!parseHours(h), "Hours look like 06:00-23:00"),
  voice: z.enum(VOICES as [string, ...string[]]),
  greeting: z.string().trim().min(10, "Greeting is too short").max(300),
  minNoticeHours: z.number().min(0).max(168),
  alertPhone: z.string(),
});

const UK_DAY_MS = 24 * 3_600_000;

export async function adminVoiceBookingRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticateAdmin] };

  const loadRequest = async (id: string) =>
    fastify.prisma.booking.findUnique({
      where: { id },
      include: { passenger: { include: { user: true } }, voiceCall: { select: { id: true } } },
    });

  /** Airport pickup with a flight: look it up as the app does, so tracking can start. */
  async function checkFlight(b: NonNullable<Awaited<ReturnType<typeof loadRequest>>>) {
    if (!b.flightNumber || !b.meetingPointId || !b.scheduledAt || b.pickupOffsetMinutes != null) return { ok: true as const, data: {} };
    const luggageType = (b.luggageType === "HAND" ? "HAND" : "CHECKED") as "HAND" | "CHECKED";
    // Arrival date (UK): the pickup day, or the day before for a pickup just after midnight.
    const days = [ukParts(b.scheduledAt).date, ukParts(new Date(b.scheduledAt.getTime() - UK_DAY_MS)).date];
    let last: any = null;
    for (const flightDate of days) {
      const r = await resolveAirportPickup(
        fastify.prisma,
        fastify.redis,
        { meetingPointId: b.meetingPointId, flightNumber: b.flightNumber, flightDate, luggageType },
        b.scheduledAt
      );
      if (r.ok) return { ok: true as const, data: r.data };
      last = r;
      if (r.code !== "not_found" && !/couldn't find/i.test(r.error)) break;
    }
    return { ok: false as const, error: last.error as string, code: last.code as string, extra: last.extra };
  }

  fastify.post("/admin/bookings/:id/approve-request", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { skipFlightCheck } = approveSchema.parse(request.body ?? {});
    const b = await loadRequest(id);
    if (!b) return reply.status(404).send({ success: false, error: "Booking not found" });
    if (!b.isOnHold || b.status !== "CONFIRMED")
      return reply.status(400).send({ success: false, error: "This booking isn't waiting for approval." });

    let flightData: Record<string, unknown> = {};
    let flightNote = "";
    if (!skipFlightCheck) {
      const f = await checkFlight(b);
      if (!f.ok)
        return reply.status(409).send({
          success: false,
          code: "flight_check",
          error: `Flight ${b.flightNumber}: ${f.error}`,
          earliestPickupUtc: f.extra?.earliestPickupUtc ?? null,
        });
      flightData = f.data;
      if (Object.keys(flightData).length) flightNote = "; flight checked, tracking on";
    } else if (b.flightNumber) flightNote = "; flight not checked (approved without)";

    const onBoard = !!b.scheduledAt && ScheduledBookingService.hasMinimumLeadTime(b.scheduledAt);
    const status = onBoard ? "SCHEDULED_OPEN" : "CONFIRMED";
    const adminUserId = request.user.userId;
    const [updated] = await fastify.prisma.$transaction([
      fastify.prisma.booking.update({
        where: { id },
        data: { ...(flightData as any), isOnHold: false, status, dispatchedBy: adminUserId, dispatchedAt: new Date() },
      }),
      fastify.prisma.bookingStatusHistory.create({
        data: { bookingId: id, status, note: `Phone request approved${onBoard ? "; on the job board" : ""}${flightNote}` },
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
    return reply.send({ success: true, data: { booking: updated, texted, flightTracked: !!flightNote && !skipFlightCheck } });
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
    const { limit = "50", outcome } = request.query as Record<string, string>;
    const where =
      outcome === "AWAITING"
        ? { booking: { is: { isOnHold: true, status: "CONFIRMED" as const } } }
        : outcome
          ? { outcome }
          : {};
    const [items, awaitingApproval] = await Promise.all([
      fastify.prisma.voiceCall.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: Math.min(Math.max(parseInt(limit) || 50, 1), 200),
        select: {
          id: true,
          callId: true,
          fromNumber: true,
          callerName: true,
          outcome: true,
          message: true,
          quote: true,
          startedAt: true,
          durationSeconds: true,
          error: true,
          passenger: { select: { id: true, isTestAccount: true } },
          booking: { select: { id: true, reference: true, status: true, isOnHold: true } },
        },
      }),
      fastify.prisma.voiceCall.count({ where: { booking: { is: { isOnHold: true, status: "CONFIRMED" } } } }),
    ]);
    return reply.send({ success: true, data: { items, awaitingApproval } });
  });

  fastify.get("/admin/voice-calls/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const call = await fastify.prisma.voiceCall.findUnique({
      where: { id },
      include: { booking: { select: { id: true, reference: true, status: true, isOnHold: true } } },
    });
    if (!call) return reply.status(404).send({ success: false, error: "Call not found" });
    return reply.send({ success: true, data: call });
  });

  fastify.get("/admin/voice-agent/settings", auth, async (_request, reply) => {
    const settings = await loadVoiceSettings(fastify.prisma);
    return reply.send({
      success: true,
      data: { settings, voices: VOICES, configured: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_WEBHOOK_SECRET) },
    });
  });

  fastify.put("/admin/voice-agent/settings", auth, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.status(400).send({ success: false, error: parsed.error.issues[0]?.message ?? "Please check the settings." });
    const s = parsed.data;
    const phone = normalizePhone(s.alertPhone);
    if (!phone) return reply.status(400).send({ success: false, error: "Alert phone isn't a valid number." });
    const values: Record<string, string> = {
      [VOICE_KEYS.mode]: s.mode,
      [VOICE_KEYS.hours]: s.hours.replace(/\s+/g, ""),
      [VOICE_KEYS.voice]: s.voice,
      [VOICE_KEYS.greeting]: s.greeting.trim(),
      [VOICE_KEYS.minNoticeHours]: String(s.minNoticeHours),
      [VOICE_KEYS.alertPhone]: phone.e164,
    };
    await fastify.prisma.$transaction(
      Object.entries(values).map(([key, value]) =>
        fastify.prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );
    fastify.log.warn(`[Araa] settings changed by ${request.user.userId}: ${s.mode} ${values[VOICE_KEYS.hours]}, ${s.voice}, ${s.minNoticeHours}h notice`);
    return reply.send({ success: true, data: { settings: await loadVoiceSettings(fastify.prisma) } });
  });
}
