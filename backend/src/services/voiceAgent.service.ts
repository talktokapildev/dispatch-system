// backend/src/services/voiceAgent.service.ts
//
// Araa, the AI phone receptionist. Calls reach OpenAI Realtime over SIP (Twilio Elastic SIP
// trunk → sip:proj_…@sip.api.openai.com); OpenAI posts `realtime.call.incoming` to
// routes/openaiWebhooks.ts, which calls handleIncomingCall() here.
//
// For each call we:
//   1. read the settings (mode / hours / voice / greeting / notice) and look the caller up by
//      phone (name, recent trips) so the script is personal;
//   2. accept the call with the script and tools, then hold a server-side WebSocket to it;
//   3. run the tools against our own code: Google places (autocompletePlaces / resolvePlace),
//      Gatwick meeting points, PricingService (the same fare the booking stores), bookings;
//   4. after the call: save the transcript and outcome (VoiceCall), text Kapil, text the caller.
//
// Bookings are created CONFIRMED + isOnHold with bookedVia PHONE and no dispatcher: they wait
// for Kapil to approve (routes/admin/voiceBookings.ts), which records him as the dispatcher and
// puts the job on the board. Prices come only from our code, never from the model.
import { Prisma, type PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { MapsService } from "./maps.service";
import { PricingService } from "./pricing.service";
import { autocompletePlaces, resolvePlace, withinDailyCap, DIRECTIONS_DAILY_CAP } from "./webQuote.service";
import { MAX_PASSENGERS, MAX_TRIP_MILES, checkPickupTime, kmToMiles, nearGatwick } from "./webQuoteRules";
import { normaliseFlightNumber } from "./flightData.service";
import { normalizePhone } from "../lib/phone";
import { sendSms as realSendSms } from "./sms.service";
import {
  VOICE_KEYS,
  alertText,
  buildInstructions,
  callerText,
  greetingFor,
  isOpen,
  money,
  parseVoiceSettings,
  speechMs,
  toolsFor,
  type CallSummary,
  type CallerContext,
  type VoiceSettings,
} from "./voiceAgentRules";

const MILES_PER_KM = 0.621371;
export const MAX_ACTIVE_CALLS = Number(process.env.VOICE_MAX_ACTIVE_CALLS ?? 3);
export const MAX_CALL_MS = Number(process.env.VOICE_MAX_CALL_MINUTES ?? 12) * 60_000;
const MODEL = () => process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";

/** The bits of a WebSocket we use (the `ws` client in production, a fake in tests). */
export interface WsLike {
  on(event: "open" | "close", cb: () => void): unknown;
  on(event: "message", cb: (data: unknown) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  send(data: string): void;
  close(): void;
}

export type VoiceDeps = {
  prisma: PrismaClient;
  redis: Redis;
  log: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
  io?: { to(room: string): { emit(ev: string, data: unknown): unknown } };
  /** OpenAI call control: accept / reject / hang up. */
  calls: {
    accept(callId: string, body: Record<string, unknown>): Promise<unknown>;
    reject(callId: string, body?: { status_code?: number }): Promise<unknown>;
    hangup(callId: string): Promise<unknown>;
  };
  /** Opens the server-side WebSocket to an accepted call. */
  connect(callId: string): WsLike;
  maps?: Pick<MapsService, "getPlaceDetails" | "getDirections" | "autocomplete">;
  pricing?: Pick<PricingService, "estimateFare">;
  sendSms?: (to: string, body: string, opts?: any) => Promise<unknown>;
  now?: () => Date;
};

type Place =
  | { kind: "google"; placeId: string; label: string }
  | { kind: "terminal"; meetingPointId: string; terminal: string; label: string; lat: number; lng: number };

type Quote = {
  id: string;
  pickup: { label: string; address: string; lat: number; lng: number; place: Place };
  dropoff: { label: string; address: string; lat: number; lng: number; place: Place };
  at: Date;
  passengers: number;
  suitcases: number;
  fare: number;
  miles: number;
  minutes: number;
  premiumLabel: string | null;
  tooSoon: boolean;
};

type Line = { at: string; who: "caller" | "araa" | "tool"; text: string };

const active = new Map<string, CallSession>();
export const activeCallCount = () => active.size;

/** "Kapil" style first name, or null for placeholder names. */
const realFirstName = (s?: string | null) => (s && !/^(unknown|customer)$/i.test(s.trim()) ? s.trim() : null);

export async function loadVoiceSettings(prisma: PrismaClient): Promise<VoiceSettings> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(VOICE_KEYS) } } });
  return parseVoiceSettings(rows);
}

/** Known passenger by phone: first name, last trips, saved addresses. */
export async function findCaller(
  prisma: PrismaClient,
  e164: string | null
): Promise<{ passengerId: string; context: CallerContext } | null> {
  if (!e164) return null;
  const passenger = await prisma.passenger.findFirst({
    where: { user: { phone: e164 } },
    select: {
      id: true,
      savedAddresses: true,
      user: { select: { firstName: true } },
      bookings: {
        where: { status: { in: ["COMPLETED", "CONFIRMED", "SCHEDULED_OPEN", "DRIVER_ASSIGNED"] } },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { pickupAddress: true, dropoffAddress: true, scheduledAt: true, createdAt: true },
      },
    },
  });
  if (!passenger) return null;
  const saved = Array.isArray(passenger.savedAddresses) ? (passenger.savedAddresses as any[]) : [];
  return {
    passengerId: passenger.id,
    context: {
      firstName: realFirstName(passenger.user.firstName),
      recentTrips: passenger.bookings.map((b) => ({
        pickup: b.pickupAddress,
        dropoff: b.dropoffAddress,
        when: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(
          b.scheduledAt ?? b.createdAt
        ),
      })),
      savedAddresses: saved
        .map((a) => [a?.label, a?.address].filter(Boolean).join(": "))
        .filter(Boolean)
        .slice(0, 5),
    },
  };
}

/** "sip:+447587545986@pstn.twilio.com" (From header) → "+447587545986", or null if withheld. */
export function callerNumber(sipHeaders: { name: string; value: string }[]): string | null {
  const from = sipHeaders.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
  const raw = from.match(/sip:([^@;>]+)/)?.[1] ?? "";
  if (!raw || /anonymous|restricted|unknown|private/i.test(raw)) return null;
  const plus = raw.startsWith("+") ? raw : raw.replace(/^00/, "+");
  // Keep any well-formed international number, even one our phone rules don't recognise.
  return normalizePhone(plus)?.e164 ?? (/^\+\d{8,15}$/.test(plus) ? plus : null);
}

// ─── Incoming call ──────────────────────────────────────────────────────────

export async function handleIncomingCall(
  deps: VoiceDeps,
  event: { call_id: string; sip_headers: { name: string; value: string }[] }
): Promise<void> {
  const callId = event.call_id;
  const now = (deps.now ?? (() => new Date()))();
  const from = callerNumber(event.sip_headers ?? []);
  const settings = await loadVoiceSettings(deps.prisma);

  if (settings.mode === "OFF" || active.size >= MAX_ACTIVE_CALLS) {
    deps.log.warn(`[Araa] rejecting call ${callId}: ${settings.mode === "OFF" ? "switched off" : "too many calls"}`);
    await deps.calls.reject(callId, { status_code: 486 }).catch(() => {});
    await deps.prisma.voiceCall
      .create({ data: { callId, fromNumber: from, outcome: "REJECTED", endedAt: now, error: settings.mode === "OFF" ? "OFF" : "BUSY" } })
      .catch(() => {});
    return;
  }

  const open = isOpen(settings, now);
  const caller = await findCaller(deps.prisma, from).catch(() => null);
  const record = await deps.prisma.voiceCall.create({
    data: { callId, fromNumber: from, passengerId: caller?.passengerId, model: MODEL(), voice: settings.voice },
  });

  const session = new CallSession(deps, { callId, recordId: record.id, from, caller, settings, open, startedAt: now });
  active.set(callId, session);
  try {
    await deps.calls.accept(callId, {
      type: "realtime",
      model: MODEL(),
      instructions: buildInstructions({ now, settings, caller: caller?.context ?? null, callerNumber: from, open }),
      tools: toolsFor(open),
      audio: {
        // A separate transcript of the caller, for the record. The model itself hears the audio.
        input: { transcription: { model: "gpt-4o-transcribe", language: "en" } },
        output: { voice: settings.voice },
      },
    });
  } catch (err: any) {
    active.delete(callId);
    deps.log.error({ err: err?.message }, `[Araa] accept failed for ${callId}`);
    await deps.prisma.voiceCall
      .update({ where: { id: record.id }, data: { outcome: "FAILED", error: `accept: ${err?.message ?? err}`.slice(0, 500), endedAt: new Date() } })
      .catch(() => {});
    return;
  }
  session.start(greetingFor(settings, caller?.context ?? null, open));
}

// ─── One call ───────────────────────────────────────────────────────────────

class CallSession {
  private ws!: WsLike;
  private transcript: Line[] = [];
  private places = new Map<string, Place>();
  private quotes = new Map<string, Quote>();
  private lastQuote: Quote | null = null;
  private pendingCalls: { call_id: string; name: string; args: any }[] = [];
  private placeCount = 0;
  private outcome: string = "IN_PROGRESS";
  private callerName: string | null = null;
  private message: string | null = null;
  private booking: CallSummary["booking"] = null;
  private ending = false; // end_call received → goodbye requested
  private goodbyeText = "";
  private finished = false;
  private sessionToken: string;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private deps: VoiceDeps,
    private c: {
      callId: string;
      recordId: string;
      from: string | null;
      caller: { passengerId: string; context: CallerContext } | null;
      settings: VoiceSettings;
      open: boolean;
      startedAt: Date;
    }
  ) {
    this.sessionToken = c.callId.replace(/[^A-Za-z0-9-]/g, "").slice(-40).padStart(8, "0");
    this.callerName = c.caller?.context.firstName ?? null;
  }

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }
  private send(ev: unknown) {
    try {
      this.ws.send(JSON.stringify(ev));
    } catch (err: any) {
      this.deps.log.warn(`[Araa] send failed: ${err?.message}`);
    }
  }
  private say(who: Line["who"], text: string) {
    if (text?.trim()) this.transcript.push({ at: this.now().toISOString(), who, text: text.trim() });
  }

  start(greeting: string) {
    this.ws = this.deps.connect(this.c.callId);
    this.ws.on("open", () =>
      this.send({ type: "response.create", response: { instructions: `Say exactly this, softly and warmly: ${greeting}` } })
    );
    this.ws.on("message", (raw) => this.onEvent(raw).catch((err) => this.deps.log.error({ err: err?.message }, "[Araa] event error")));
    this.ws.on("close", () => void this.finish());
    this.ws.on("error", (err) => this.deps.log.warn(`[Araa] socket error ${this.c.callId}: ${err?.message}`));
    // Safety net: no call runs forever.
    this.timers.push(setTimeout(() => this.hangup("max length"), MAX_CALL_MS));
  }

  private async onEvent(raw: unknown) {
    let ev: any;
    try {
      ev = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (ev.type) {
      case "conversation.item.input_audio_transcription.completed":
        this.say("caller", ev.transcript ?? "");
        break;
      case "response.output_audio_transcript.done":
        this.say("araa", ev.transcript ?? "");
        if (this.ending) this.goodbyeText += ` ${ev.transcript ?? ""}`;
        break;
      case "response.function_call_arguments.done": {
        let args: any = {};
        try {
          args = JSON.parse(ev.arguments || "{}");
        } catch {}
        this.pendingCalls.push({ call_id: ev.call_id, name: ev.name, args });
        break;
      }
      case "response.done":
        await this.afterResponse();
        break;
      case "error":
        // Harmless race (a reply already in progress); anything else is worth a log line.
        if (ev.error?.code !== "conversation_already_has_active_response")
          this.deps.log.warn({ error: ev.error }, `[Araa] realtime error on ${this.c.callId}`);
        break;
    }
  }

  /** One reply finished: run every tool it asked for, then continue once (not once per tool). */
  private async afterResponse() {
    if (this.ending && !this.pendingCalls.length) {
      // That was the goodbye: hang up once it has been spoken.
      const t = setTimeout(() => this.hangup("goodbye"), speechMs(this.goodbyeText));
      this.timers.push(t);
      return;
    }
    if (!this.pendingCalls.length) return;
    const calls = this.pendingCalls.splice(0);
    let wantsEnd = false;
    for (const call of calls) {
      let result: unknown;
      try {
        result = await this.runTool(call.name, call.args);
      } catch (err: any) {
        this.deps.log.error({ err: err?.message, tool: call.name }, "[Araa] tool failed");
        result = { error: "That didn't work just now. Apologise, take a message and say someone will call back." };
      }
      if (call.name === "end_call") wantsEnd = true;
      this.say("tool", `${call.name} ${JSON.stringify(call.args)} → ${JSON.stringify(result)}`.slice(0, 2000));
      this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) } });
    }
    if (wantsEnd) {
      this.ending = true;
      const booked = this.outcome === "BOOKED";
      this.send({
        type: "response.create",
        response: {
          tool_choice: "none",
          instructions: `Now say a short, warm goodbye${booked ? ", reminding them we'll text to confirm their booking" : ""}. Don't ask any more questions.`,
        },
      });
    } else {
      this.send({ type: "response.create" });
    }
    void this.save();
  }

  // ─── Tools ───
  private async runTool(name: string, args: any): Promise<unknown> {
    switch (name) {
      case "find_place":
        return this.findPlace(String(args.query ?? ""));
      case "gatwick_terminal":
        return this.gatwickTerminal(String(args.terminal ?? "").toUpperCase());
      case "get_quote":
        return this.getQuote(args);
      case "create_booking":
        return this.createBooking(args);
      case "take_message":
        return this.takeMessage(args);
      case "end_call":
        return { ok: true };
      default:
        return { error: "Unknown tool" };
    }
  }

  private async findPlace(query: string) {
    const q = query.trim().slice(0, 100);
    if (q.length < 3) return { matches: [], note: "Ask for a bit more detail." };
    if (/\b(gatwick|lgw)\b/i.test(q) && /\b(airport|terminal|north|south|lgw)\b/i.test(q))
      return { matches: [], note: "For Gatwick Airport, ask North or South Terminal and use gatwick_terminal." };
    const list = await autocompletePlaces(this.quoteDeps(), q, this.sessionToken);
    if (list === "BUSY") return { matches: [], note: "Address lookup is unavailable. Take a message instead." };
    const matches = list.map((p) => {
      const id = `p${++this.placeCount}`;
      const label = [p.mainText, p.secondaryText].filter(Boolean).join(", ");
      this.places.set(id, { kind: "google", placeId: p.placeId, label });
      return { id, name: p.mainText, area: p.secondaryText };
    });
    return matches.length ? { matches } : { matches: [], note: "Nothing found. Ask for more detail or the postcode." };
  }

  private async gatwickTerminal(terminal: string) {
    if (terminal !== "NORTH" && terminal !== "SOUTH") return { error: "Terminal must be NORTH or SOUTH." };
    const mp = await this.deps.prisma.airportMeetingPoint.findFirst({ where: { airportIata: "LGW", terminal, isActive: true } });
    if (!mp) return { error: "That terminal isn't set up. Take a message." };
    const id = terminal === "NORTH" ? "gatwick_north" : "gatwick_south";
    const label = `Gatwick ${terminal === "NORTH" ? "North" : "South"} Terminal: ${mp.name}`;
    this.places.set(id, { kind: "terminal", meetingPointId: mp.id, terminal, label, lat: mp.latitude, lng: mp.longitude });
    return { id, name: `Gatwick ${terminal === "NORTH" ? "North" : "South"} Terminal`, meeting_point: mp.name };
  }

  private async resolve(id: string) {
    const place = this.places.get(id);
    if (!place) return null;
    if (place.kind === "terminal") return { label: place.label, address: place.label, lat: place.lat, lng: place.lng, place };
    const r = await resolvePlace(this.quoteDeps(), this.maps(), place.placeId, this.sessionToken);
    return { label: place.label, address: r.address, lat: r.lat, lng: r.lng, place };
  }

  private async getQuote(args: any) {
    const [pickup, dropoff] = await Promise.all([this.resolve(String(args.pickup_id)), this.resolve(String(args.destination_id))]);
    if (!pickup || !dropoff) return { error: "Unknown place id. Look the place up first." };
    if (pickup.lat === dropoff.lat && pickup.lng === dropoff.lng) return { error: "Pickup and destination are the same place." };
    const passengers = Math.max(1, Number(args.passengers) || 1);
    const suitcases = Math.max(0, Number(args.suitcases) || 0);
    if (passengers > MAX_PASSENGERS) return { error: `We carry up to ${MAX_PASSENGERS} passengers. Take a message so someone can help.` };

    const now = this.now();
    const time = checkPickupTime(String(args.date ?? ""), String(args.time ?? ""), now);
    if (!time.ok) return { error: time.error };
    const at = time.pickupAt!;
    const tooSoon = at.getTime() < now.getTime() + this.c.settings.minNoticeHours * 3_600_000;

    const quoteBase = { when: at, pickup: pickup.label, dropoff: dropoff.label };
    if (!nearGatwick(pickup, dropoff)) {
      this.setOutcome("OUT_OF_AREA");
      await this.saveQuote({ ...quoteBase, fare: null, outOfArea: true });
      return { out_of_area: true };
    }

    const route = await this.route(pickup, dropoff, now);
    if (route === "BUSY") return { error: "Pricing is unavailable just now. Take a message." };
    const miles = kmToMiles(route.km);
    if (miles > MAX_TRIP_MILES) {
      this.setOutcome("OUT_OF_AREA");
      await this.saveQuote({ ...quoteBase, fare: null, outOfArea: true });
      return { out_of_area: true };
    }
    // Exactly what the admin booking flow prices with, so the booking stores the fare quoted.
    const estimate = await this.pricing().estimateFare({
      distanceMiles: route.km * MILES_PER_KM,
      durationMinutes: route.minutes,
      pickupLatitude: pickup.lat,
      pickupLongitude: pickup.lng,
      dropoffLatitude: dropoff.lat,
      dropoffLongitude: dropoff.lng,
      scheduledAt: at,
    });
    const quote: Quote = {
      id: `q${this.quotes.size + 1}`,
      pickup,
      dropoff,
      at,
      passengers,
      suitcases,
      fare: estimate.total,
      miles,
      minutes: route.minutes,
      premiumLabel: estimate.timePremiumAmount > 0 ? estimate.timePremiumLabel : null,
      tooSoon,
    };
    this.quotes.set(quote.id, quote);
    this.lastQuote = quote;
    if (tooSoon) this.setOutcome("TOO_SOON");
    await this.saveQuote({ ...quoteBase, fare: quote.fare, miles, premium: quote.premiumLabel, tooSoon });
    return {
      quote_id: quote.id,
      fare: money(quote.fare),
      premium: quote.premiumLabel,
      too_soon: tooSoon,
      minimum_notice_hours: this.c.settings.minNoticeHours,
      pickup: pickup.label,
      destination: dropoff.label,
      miles,
    };
  }

  private async route(a: { lat: number; lng: number }, b: { lat: number; lng: number }, now: Date) {
    const key = `voice:route:${a.lat.toFixed(5)},${a.lng.toFixed(5)}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
    const hit = await this.deps.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as { km: number; minutes: number };
    if (!(await withinDailyCap(this.deps.redis, "directions", DIRECTIONS_DAILY_CAP, now, this.deps.log))) return "BUSY" as const;
    const r = await this.maps().getDirections({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    const route = { km: r.distanceKm, minutes: r.durationMinutes };
    await this.deps.redis.set(key, JSON.stringify(route), "EX", 24 * 3600).catch(() => {});
    return route;
  }

  private async createBooking(args: any) {
    if (this.booking) return { error: "A booking was already made on this call.", reference: this.booking.reference };
    const quote = this.quotes.get(String(args.quote_id)) ?? this.lastQuote;
    if (!quote) return { error: "Get a quote first." };
    if (quote.tooSoon) return { error: "Too soon to book. Take a message instead." };
    if (quote.at.getTime() < this.now().getTime() + this.c.settings.minNoticeHours * 3_600_000)
      return { error: "Too soon to book now. Take a message instead." };

    const name = String(args.name ?? "").trim().slice(0, 80);
    if (!name) return { error: "Ask for their name." };
    const phone = this.c.from ?? normalizePhone(String(args.phone ?? ""))?.e164 ?? null;
    if (!phone) return { error: "Ask for a mobile number and read it back." };
    this.callerName = name;

    const prisma = this.deps.prisma;
    // Same account rules as admin bookings: one passenger per phone number.
    let passengerId: string | null = null;
    const user = await prisma.user.findUnique({ where: { phone }, include: { passenger: true } });
    if (user) {
      passengerId = user.passenger?.id ?? (await prisma.passenger.create({ data: { userId: user.id } })).id;
      if (!realFirstName(user.firstName)) {
        const [first, ...rest] = name.split(/\s+/);
        await prisma.user.update({ where: { id: user.id }, data: { firstName: first, lastName: rest.join(" ") || user.lastName } }).catch(() => {});
      }
    } else {
      const [first, ...rest] = name.split(/\s+/);
      const created = await prisma.user.create({
        data: {
          phone,
          firstName: first || "Unknown",
          lastName: rest.join(" ") || "Customer",
          roles: ["PASSENGER"],
          isVerified: false,
          passenger: { create: {} },
        },
        include: { passenger: true },
      });
      passengerId = created.passenger!.id;
    }

    const pickupTerminal = quote.pickup.place.kind === "terminal" ? quote.pickup.place : null;
    const dropoffTerminal = quote.dropoff.place.kind === "terminal" ? quote.dropoff.place : null;
    const flight = args.flight_number ? normaliseFlightNumber(String(args.flight_number)) ?? String(args.flight_number).slice(0, 12) : null;
    const bookingFor = name && this.c.caller?.context.firstName && !name.toLowerCase().startsWith(this.c.caller.context.firstName.toLowerCase()) ? ` Passenger: ${name}.` : "";
    const notes = [
      `${quote.suitcases} suitcase${quote.suitcases === 1 ? "" : "s"}.`,
      args.notes ? String(args.notes).slice(0, 300) : "",
      bookingFor.trim(),
    ]
      .filter(Boolean)
      .join(" ");

    const booking = await prisma.booking.create({
      data: {
        reference: makeRef(),
        passengerId,
        type: pickupTerminal ? "AIRPORT_PICKUP" : dropoffTerminal ? "AIRPORT_DROPOFF" : "PREBOOKED",
        status: "CONFIRMED",
        isOnHold: true, // waits for Kapil's approval
        pickupAddress: quote.pickup.address,
        pickupLatitude: quote.pickup.lat,
        pickupLongitude: quote.pickup.lng,
        dropoffAddress: quote.dropoff.address,
        dropoffLatitude: quote.dropoff.lat,
        dropoffLongitude: quote.dropoff.lng,
        scheduledAt: quote.at,
        bookedPickupAt: pickupTerminal ? quote.at : undefined,
        estimatedFare: quote.fare,
        paymentMethod: "CASH",
        passengerCount: quote.passengers,
        flightNumber: flight,
        terminal: pickupTerminal?.terminal ?? dropoffTerminal?.terminal ?? null,
        meetingPointId: pickupTerminal?.meetingPointId ?? null,
        notes,
        operatorNotes:
          "Booked by phone with Araa (AI assistant). Waiting for your approval. Payment method not discussed: check with the passenger." +
          (flight ? " Flight not verified." : ""),
        bookedVia: "PHONE",
        bookedAt: this.c.startedAt,
      },
    });
    await prisma.bookingStatusHistory
      .create({ data: { bookingId: booking.id, status: "CONFIRMED", note: "Requested by phone via Araa (AI assistant); on hold for approval" } })
      .catch(() => {});
    await prisma.voiceCall.update({ where: { id: this.c.recordId }, data: { bookingId: booking.id, passengerId } }).catch(() => {});
    this.deps.io?.to("admin").emit("admin:booking_created", booking);

    this.booking = {
      id: booking.id,
      reference: booking.reference,
      when: quote.at,
      pickup: quote.pickup.label,
      dropoff: quote.dropoff.label,
      fare: quote.fare,
      passengers: quote.passengers,
    };
    this.outcome = "BOOKED";
    return { saved: true, reference: booking.reference, note: "It's a request: we'll text to confirm shortly." };
  }

  private async takeMessage(args: any) {
    const name = String(args.name ?? "").trim().slice(0, 80);
    const about = String(args.about ?? "").trim().slice(0, 500);
    if (name) this.callerName = name;
    const phone = this.c.from ? null : normalizePhone(String(args.phone ?? ""))?.e164 ?? (args.phone ? String(args.phone).slice(0, 30) : null);
    this.message = [about, phone ? `(call back on ${phone})` : ""].filter(Boolean).join(" ");
    if (this.outcome === "IN_PROGRESS" || this.outcome === "NO_BOOKING") this.outcome = "MESSAGE";
    void this.save();
    return { saved: true };
  }

  private setOutcome(o: string) {
    if (this.outcome !== "BOOKED" && this.outcome !== "MESSAGE") this.outcome = o;
  }

  private async saveQuote(q: Record<string, unknown>) {
    await this.deps.prisma.voiceCall
      .update({ where: { id: this.c.recordId }, data: { quote: q as Prisma.InputJsonValue } })
      .catch(() => {});
  }

  private async save() {
    await this.deps.prisma.voiceCall
      .update({
        where: { id: this.c.recordId },
        data: {
          transcript: this.transcript as unknown as Prisma.InputJsonValue,
          callerName: this.callerName,
          message: this.message,
        },
      })
      .catch(() => {});
  }

  private hangup(reason: string) {
    this.deps.log.info(`[Araa] hanging up ${this.c.callId} (${reason})`);
    this.deps.calls.hangup(this.c.callId).catch(() => {});
    // If OpenAI doesn't close the socket, close it ourselves.
    this.timers.push(setTimeout(() => this.ws?.close(), 3000));
  }

  // ─── After the call ───
  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.timers.forEach(clearTimeout);
    active.delete(this.c.callId);

    const endedAt = this.now();
    const durationSeconds = Math.round((endedAt.getTime() - this.c.startedAt.getTime()) / 1000);
    if (this.outcome === "IN_PROGRESS") this.outcome = this.transcript.some((l) => l.who === "caller") ? "NO_BOOKING" : "FAILED";
    if (this.outcome === "NO_BOOKING" && durationSeconds < 5) this.outcome = "FAILED";

    await this.deps.prisma.voiceCall
      .update({
        where: { id: this.c.recordId },
        data: {
          outcome: this.outcome,
          callerName: this.callerName,
          message: this.message,
          transcript: this.transcript as unknown as Prisma.InputJsonValue,
          endedAt,
          durationSeconds,
        },
      })
      .catch((err) => this.deps.log.error({ err: err?.message }, "[Araa] saving call failed"));

    const summary: CallSummary = {
      outcome: this.outcome,
      fromNumber: this.c.from,
      callerName: this.callerName,
      durationSeconds,
      booking: this.booking,
      quote: this.lastQuote ? { when: this.lastQuote.at, pickup: this.lastQuote.pickup.label, dropoff: this.lastQuote.dropoff.label, fare: this.lastQuote.fare } : null,
      message: this.message,
    };
    const sms = this.deps.sendSms ?? realSendSms;
    await sms(this.c.settings.alertPhone, alertText(summary), { purpose: "ADMIN_ALERT", bookingId: this.booking?.id ?? null }).catch(
      (err) => this.deps.log.error({ err: err?.message }, "[Araa] alert SMS failed")
    );
    const toCaller = callerText(summary);
    const callerPhone = this.c.from ?? null;
    if (toCaller && callerPhone && normalizePhone(callerPhone)?.isMobile !== false)
      await sms(callerPhone, toCaller, { purpose: "OTHER", bookingId: this.booking?.id ?? null }).catch(
        (err) => this.deps.log.error({ err: err?.message }, "[Araa] caller SMS failed")
      );
    this.deps.log.info(`[Araa] call ${this.c.callId} ended: ${this.outcome} (${durationSeconds}s)`);
  }

  // ─── Helpers ───
  private maps() {
    return this.deps.maps ?? new MapsService();
  }
  private pricing() {
    return this.deps.pricing ?? new PricingService(this.deps.prisma, this.deps.redis);
  }
  private quoteDeps() {
    return { prisma: this.deps.prisma, redis: this.deps.redis, maps: this.maps(), now: this.deps.now, log: this.deps.log };
  }
}

/** Same format as other booking references (DS…). */
const makeRef = () =>
  `DS${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
