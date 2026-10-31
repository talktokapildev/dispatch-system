// backend/src/services/voiceAgentRules.ts
//
// Pure rules for Araa, the AI phone receptionist (no database, no network), so they can be
// tested on their own (scripts/test-voice-agent-rules.ts): settings, opening hours, the
// script, and the texts sent after a call.

/** SystemSetting keys (admin Settings; no deploy needed to change them). */
export const VOICE_KEYS = {
  mode: "voiceAgentMode", // ALWAYS | HOURS | OFF
  hours: "voiceAgentHours", // "06:00-23:00" (UK time; may run past midnight, e.g. "18:00-02:00")
  voice: "voiceAgentVoice",
  greeting: "voiceAgentGreeting",
  minNoticeHours: "voiceAgentMinNoticeHours",
  alertPhone: "voiceAgentAlertPhone",
  faq: "voiceAgentFaq", // facts Araa may use to answer questions (written by Kapil)
} as const;

export const MAX_FAQ = 3000;

export type VoiceMode = "ALWAYS" | "HOURS" | "OFF";

export type VoiceSettings = {
  mode: VoiceMode;
  hours: string;
  voice: string;
  greeting: string;
  minNoticeHours: number;
  alertPhone: string;
  faq: string;
};

export const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

export const DEFAULT_GREETING =
  "Hello, you're through to OrangeRide. I'm Araa, the virtual assistant. How can I help?";

export const VOICE_DEFAULTS: VoiceSettings = {
  mode: "ALWAYS",
  hours: "06:00-23:00",
  voice: "marin",
  greeting: DEFAULT_GREETING,
  minNoticeHours: 24,
  alertPhone: "+447398341839",
  faq: "",
};

/** Settings rows → settings, falling back to the defaults for anything missing or invalid. */
export function parseVoiceSettings(rows: { key: string; value: string }[]): VoiceSettings {
  const m = new Map(rows.map((r) => [r.key, r.value.trim()]));
  const mode = (m.get(VOICE_KEYS.mode) ?? "").toUpperCase();
  const hours = m.get(VOICE_KEYS.hours) ?? "";
  const voice = (m.get(VOICE_KEYS.voice) ?? "").toLowerCase();
  const notice = Number(m.get(VOICE_KEYS.minNoticeHours));
  const alert = m.get(VOICE_KEYS.alertPhone) ?? "";
  return {
    mode: (["ALWAYS", "HOURS", "OFF"].includes(mode) ? mode : VOICE_DEFAULTS.mode) as VoiceMode,
    hours: parseHours(hours) ? hours : VOICE_DEFAULTS.hours,
    voice: VOICES.includes(voice) ? voice : VOICE_DEFAULTS.voice,
    greeting: m.get(VOICE_KEYS.greeting) || VOICE_DEFAULTS.greeting,
    minNoticeHours: Number.isFinite(notice) && notice >= 0 && notice <= 168 ? notice : VOICE_DEFAULTS.minNoticeHours,
    alertPhone: /^\+\d{8,15}$/.test(alert) ? alert : VOICE_DEFAULTS.alertPhone,
    faq: (m.get(VOICE_KEYS.faq) ?? "").slice(0, MAX_FAQ),
  };
}

/** "06:00-23:00" → minutes since midnight [start, end]; null if invalid. */
export function parseHours(s: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const a = h1 * 60 + m1;
  const b = h2 * 60 + m2;
  if (a === b || a > 1440 || b > 1440) return null;
  return [a, b];
}

/** UK wall-clock parts of an instant. */
export function ukParts(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Is Araa answering bookings now? (OFF → never; ALWAYS → always; HOURS → inside the window.) */
export function isOpen(settings: Pick<VoiceSettings, "mode" | "hours">, now: Date): boolean {
  if (settings.mode === "OFF") return false;
  if (settings.mode === "ALWAYS") return true;
  const h = parseHours(settings.hours);
  if (!h) return true;
  const t = ukParts(now).minutes;
  const [a, b] = h;
  return a < b ? t >= a && t < b : t >= a || t < b; // window may run past midnight
}

/** "Friday 30 October 2026, 08:41". */
export function ukNowText(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

/** "Sat 31 Oct, 15:30" for texts and summaries. */
export function ukShort(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

export const money = (n: number) => `£${n.toFixed(2)}`;

export type CallerContext = {
  firstName: string | null;
  recentTrips: { pickup: string; dropoff: string; when: string }[];
  savedAddresses: string[];
};

/** Greeting: personal for a known passenger, the configured one otherwise. */
export function greetingFor(settings: VoiceSettings, caller: CallerContext | null, open: boolean): string {
  const name = caller?.firstName && !/^unknown$/i.test(caller.firstName) ? caller.firstName : null;
  if (!open)
    return name
      ? `Hello ${name}, it's Araa at OrangeRide. We're closed for bookings just now, but I can still help with other things or take a message. How can I help?`
      : "Hello, you're through to OrangeRide. I'm Araa, the virtual assistant. We're closed for bookings just now, but I can still help with other things or take a message. How can I help?";
  return name
    ? `Hi ${name}, lovely to hear from you again! It's Araa at OrangeRide. How can I help today?`
    : settings.greeting;
}

/** The script for one call. */
export function buildInstructions(opts: {
  now: Date;
  settings: VoiceSettings;
  caller: CallerContext | null;
  callerNumber: string | null;
  open: boolean;
}): string {
  const { now, settings, caller, callerNumber, open } = opts;
  const name = caller?.firstName && !/^unknown$/i.test(caller.firstName) ? caller.firstName : null;

  const who = name
    ? `The caller is ${name}, a returning OrangeRide passenger (recognised from their number). Use their name now and then, naturally. Phones get shared, so before booking, check the trip is for ${name}; if it's for someone else, ask that person's name.` +
      (caller!.recentTrips.length
        ? `\nTheir recent trips (offer these as shortcuts, e.g. "Gatwick North again?"):\n${caller!.recentTrips
            .map((t) => `- ${t.when}: ${t.pickup} → ${t.dropoff}`)
            .join("\n")}`
        : "") +
      (caller!.savedAddresses.length ? `\nTheir saved addresses: ${caller!.savedAddresses.join("; ")}` : "")
    : callerNumber
      ? "The caller isn't a known passenger yet."
      : "The caller's number is withheld. If they book or leave a message, ask for a mobile number and read it back.";

  const personality = `
You are Araa (say it "AH-rah"), the virtual assistant who answers the phone for OrangeRide, a
licensed private hire taxi company in Crawley, next to Gatwick Airport. It is now
${ukNowText(now)} (UK time). If asked, say you're an automated assistant and that a person can
call them back.

Personality: warm, friendly and genuinely helpful, with a light, gentle sense of humour (a
small friendly remark is lovely; never sarcasm, never jokes about delays, complaints, lost
property or anyone who sounds upset). Speak softly and calmly, at an unhurried pace, in British
English. Keep it brief: one or two short sentences per turn, one question at a time. Callers
may have any accent; if you're unsure what you heard, ask them to repeat or spell it. Never
guess names, addresses, numbers or prices. Don't narrate what you're doing ("let me check");
at most once, very briefly, if a lookup takes a moment.

${who}`.trim();

  const faq = settings.faq.trim()
    ? `Questions about OrangeRide (our cars, services, areas, payment and so on): answer ONLY from
these facts, written by OrangeRide. If the answer isn't here, say you're not sure and offer to
take a message so someone can call back. Never guess or invent details, prices or promises.
--- OrangeRide facts ---
${settings.faq.trim()}
--- end of facts ---`
    : `Questions about OrangeRide's services that this script doesn't answer: say you're not sure
and offer to take a message so someone can call back. Never guess or invent details.`;

  const otherThings = `Not a new booking:
- Complaint (driver, car, late, route, price, safety…): listen fully and let them finish. Be
  warm and sincere: say you're sorry to hear it and that it will be looked into. Don't argue,
  admit fault, blame the driver or promise refunds or compensation. If anyone is in danger right
  now, tell them to call 999 first. Find the trip: call find_my_trips and check which one with
  them (date and route); if it isn't listed, ask roughly when and where and carry on without it.
  Ask what happened, roughly when, and their name. Read a short summary back, then call
  report_feedback with kind COMPLAINT and the best category. Give them the reference it returns
  (say it slowly, e.g. "C C, 2026, 4") and say someone will be in touch within 48 hours.
- Something left in a car: find the trip the same way. Ask what the item is (colour, make,
  anything distinctive) and where in the car it might be, and their name. Call
  report_lost_property, give the reference, and say we'll check with the driver and contact them.
  Don't promise it will be found.
- Compliment or kind feedback: thank them warmly (a little delight is fine here). Find the trip
  if they mention one, then call report_feedback with kind COMPLIMENT and their words.
- An existing booking (times, changes, cancelling), a refund, or anything else: take their name
  and what it's about, call take_message, and say someone will call them back soon.

${faq}`;

  if (!open)
    return `${personality}

We're closed for bookings at the moment: don't take bookings or give prices. For a booking, take
a message (their name, the trip and when) with take_message and say someone will call back as
soon as we're open. You can still help with everything below.

${otherThings}

Ending: when the caller is done, call end_call (you'll then be asked to say goodbye).`;

  return `${personality}

Taking a journey request:
1. Pickup.
   - Gatwick Airport: ask "North or South Terminal?" and call gatwick_terminal. (If they don't
     know, ask the airline; easyJet is mostly North, British Airways mostly South. If still unsure,
     note it and pick the one they think.) Ask for the flight number; if they don't have it,
     that's absolutely fine, carry on.
   - Anywhere else: call find_place with what they said (station, hotel, street, postcode).
     Read back the best match's name and area ("Three Bridges station in Crawley?"). If none
     fit, ask for more detail. Only ask for a postcode when a house address isn't found.
2. Destination, the same way (Gatwick drop-offs: gatwick_terminal too).
3. Date and time. Work out the real date from today ("tomorrow" = the day after today).
4. Passengers and suitcases. We carry up to 4 passengers; for more, take a message.
Then call get_quote and give the fare as returned (e.g. "sixty-seven pounds forty-two").
- too_soon: we need ${settings.minNoticeHours} hours' notice for bookings. Apologise, offer to
  take a message so someone can call back if they can help, and don't book.
- out_of_area: say it's outside the area we cover and offer to take a message.
5. Their name (and for withheld numbers, a mobile number).
6. Payment: "Would you like to pay by cash or card on the day?" Our drivers take both (card
   reader in the car). We don't take card details over the phone; never ask for them.
Read the whole journey back once (pickup, destination, day and time, passengers, fare, cash or
card) and ask them to confirm. When they say yes, call create_booking. Then tell them: it's a request, we'll
text them shortly to confirm, and a text with the details is on its way now.

${otherThings}

Ending: when the caller is done, call end_call (you'll then be asked to say goodbye).`;
}

/** The tools Araa can use. Open → all; closed → message only. */
export function toolsFor(open: boolean) {
  const takeMessage = {
    type: "function" as const,
    name: "take_message",
    description: "Save a message for a call-back (anything that isn't a new booking, or a booking we can't take).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        about: { type: "string", description: "What it's about, in a sentence or two" },
        phone: { type: "string", description: "Only if their number is withheld: the number they gave" },
      },
      required: ["name", "about"],
    },
  };
  const endCall = {
    type: "function" as const,
    name: "end_call",
    description: "Finish the call. You'll be asked to say goodbye; the line then closes.",
    parameters: { type: "object", properties: {} },
  };
  const findMyTrips = {
    type: "function" as const,
    name: "find_my_trips",
    description: "The caller's recent OrangeRide trips (by their phone number), each with an id, to link a complaint, lost item or compliment.",
    parameters: { type: "object", properties: {} },
  };
  const reportFeedback = {
    type: "function" as const,
    name: "report_feedback",
    description: "Record a complaint or a compliment in OrangeRide's register. For complaints, only after reading a short summary back.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["COMPLAINT", "COMPLIMENT"] },
        category: {
          type: "string",
          enum: ["Driver behaviour", "Vehicle condition", "Late arrival", "Wrong route taken", "Overcharged", "Safety concern", "Other"],
          description: "Complaints only",
        },
        details: { type: "string", description: "What happened, in the caller's words (a few sentences), incl. roughly when" },
        trip_id: { type: "string", description: "From find_my_trips, if they confirmed which trip" },
        name: { type: "string" },
        phone: { type: "string", description: "Only if their number is withheld" },
      },
      required: ["kind", "details", "name"],
    },
  };
  const reportLost = {
    type: "function" as const,
    name: "report_lost_property",
    description: "Record something the caller left in one of our cars.",
    parameters: {
      type: "object",
      properties: {
        item: { type: "string", description: "What it is: colour, make, anything distinctive, and where in the car" },
        trip_id: { type: "string", description: "From find_my_trips, if they confirmed which trip" },
        when_where: { type: "string", description: "If no trip_id: roughly when and where the trip was" },
        name: { type: "string" },
        phone: { type: "string", description: "Only if their number is withheld" },
      },
      required: ["item", "name"],
    },
  };
  const others = [findMyTrips, reportFeedback, reportLost, takeMessage, endCall];
  if (!open) return others;
  return [
    {
      type: "function" as const,
      name: "find_place",
      description:
        "Look up a UK place (station, hotel, street address or postcode). Not for Gatwick Airport: use gatwick_terminal. Returns up to 5 matches with ids for get_quote.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What the caller said, e.g. 'Three Bridges station Crawley'" } },
        required: ["query"],
      },
    },
    {
      type: "function" as const,
      name: "gatwick_terminal",
      description: "Gatwick Airport pickup or drop-off at North or South Terminal. Returns an id for get_quote.",
      parameters: {
        type: "object",
        properties: { terminal: { type: "string", enum: ["NORTH", "SOUTH"] } },
        required: ["terminal"],
      },
    },
    {
      type: "function" as const,
      name: "get_quote",
      description: "Get the fare once pickup, destination, date, time, passengers and suitcases are known.",
      parameters: {
        type: "object",
        properties: {
          pickup_id: { type: "string" },
          destination_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD (UK)" },
          time: { type: "string", description: "HH:MM 24-hour (UK)" },
          passengers: { type: "integer" },
          suitcases: { type: "integer" },
        },
        required: ["pickup_id", "destination_id", "date", "time", "passengers", "suitcases"],
      },
    },
    {
      type: "function" as const,
      name: "create_booking",
      description: "Save the booking request the caller confirmed. Only after reading it back and hearing yes.",
      parameters: {
        type: "object",
        properties: {
          quote_id: { type: "string", description: "From get_quote" },
          name: { type: "string", description: "Passenger's name" },
          flight_number: { type: "string", description: "If they gave one" },
          phone: { type: "string", description: "Only if their number is withheld" },
          payment: { type: "string", enum: ["CASH", "CARD"], description: "How they'll pay the driver on the day" },
          notes: { type: "string", description: "Anything useful for the driver (child seat, mobility, etc.)" },
        },
        required: ["quote_id", "name", "payment"],
      },
    },
    ...others,
  ];
}

/** Rough speaking time, so the line isn't cut mid-goodbye (~14 characters a second, + 1.5 s). */
export function speechMs(text: string): number {
  return Math.min(15_000, 1500 + Math.round((text.length / 14) * 1000));
}

export type CallSummary = {
  outcome: string;
  fromNumber: string | null;
  callerName: string | null;
  durationSeconds: number | null;
  booking?: { reference: string; id: string; when: Date; pickup: string; dropoff: string; fare: number; passengers: number } | null;
  quote?: { when: Date; pickup: string; dropoff: string; fare: number | null } | null;
  message?: string | null;
  /** Complaints, compliments and lost property Araa recorded on this call. */
  reports?: { kind: "COMPLAINT" | "COMPLIMENT" | "LOST_PROPERTY"; ref: string; summary: string }[];
};

const REPORT_LABEL = { COMPLAINT: "complaint", COMPLIMENT: "compliment", LOST_PROPERTY: "lost property" } as const;

const ADMIN_URL = process.env.ADMIN_URL ?? "https://admin.orangeride.co.uk";

/** Text to Kapil after every call. */
export function alertText(s: CallSummary): string {
  const base = baseAlert(s);
  const reports = s.reports ?? [];
  if (!reports.length) return base;
  const lines = reports.map((r) => `${REPORT_LABEL[r.kind]} ${r.ref}: ${r.summary}`.slice(0, 220)).join("; ");
  const who = [s.callerName, s.fromNumber ?? "withheld number"].filter(Boolean).join(", ");
  const reportText = `Araa: ${lines} (from ${who}). Details: ${ADMIN_URL}/alerts`;
  // A report-only call: just the reports (plus any message); otherwise the main outcome first.
  if (["NO_BOOKING", "COMPLAINT", "COMPLIMENT", "LOST_PROPERTY"].includes(s.outcome))
    return s.message ? `${reportText} Message: ${s.message}. Please call back.` : reportText;
  return `${base} Also ${reportText.replace(/^Araa: /, "")}`;
}

function baseAlert(s: CallSummary): string {
  const who = [s.callerName, s.fromNumber ?? "withheld number"].filter(Boolean).join(", ");
  const len = s.durationSeconds != null ? ` (${Math.max(1, Math.round(s.durationSeconds / 60))} min)` : "";
  switch (s.outcome) {
    case "BOOKED":
      return `Araa: new booking request from ${who}${len}. ${ukShort(s.booking!.when)}, ${s.booking!.pickup} → ${s.booking!.dropoff}, ${s.booking!.passengers} pax, ${money(s.booking!.fare)}. Approve: ${ADMIN_URL}/bookings?open=${s.booking!.id}`;
    case "TOO_SOON":
      return `Araa: ${who} wanted ${s.quote ? `${ukShort(s.quote.when)}, ${s.quote.pickup} → ${s.quote.dropoff}` : "a trip"} (too soon to book).${s.message ? ` Message: ${s.message}` : ""} Please call back.`;
    case "OUT_OF_AREA":
      return `Araa: ${who} asked for a trip outside our area${s.quote ? ` (${s.quote.pickup} → ${s.quote.dropoff})` : ""}.${s.message ? ` Message: ${s.message}` : ""}`;
    case "MESSAGE":
      return `Araa: message from ${who}${len}: ${s.message ?? "(no details)"}. Please call back.`;
    case "FAILED":
      return `Araa: a call from ${who} dropped or failed. You may want to call back.`;
    default:
      return `Araa: call from ${who}${len}, no booking or message.`;
  }
}

/** Text to the caller (only after a booking request or a message). */
export function callerText(s: CallSummary): string | null {
  const hi = s.callerName ? `Hi ${s.callerName.split(" ")[0]}, ` : "Hi, ";
  if (s.outcome === "BOOKED" && s.booking)
    return `${hi}thanks for calling OrangeRide. We've got your request: ${ukShort(s.booking.when)}, ${s.booking.pickup} → ${s.booking.dropoff}, ${money(s.booking.fare)} (ref ${s.booking.reference}). We'll text you shortly to confirm.`;
  const reports = s.reports ?? [];
  const complaint = reports.find((r) => r.kind === "COMPLAINT");
  const lost = reports.find((r) => r.kind === "LOST_PROPERTY");
  if (complaint)
    return `${hi}thanks for calling OrangeRide. We're sorry about your experience. Your complaint is recorded as ${complaint.ref} and we'll be in touch within 48 hours.${lost ? ` Your lost item is logged as ${lost.ref}.` : ""}`;
  if (lost)
    return `${hi}thanks for calling OrangeRide. Your lost item is logged as ${lost.ref}. We'll check with the driver and let you know.`;
  if (s.outcome === "MESSAGE" || s.outcome === "TOO_SOON" || s.outcome === "OUT_OF_AREA")
    return `${hi}thanks for calling OrangeRide. We've got your message and will call you back soon.`;
  if (reports.some((r) => r.kind === "COMPLIMENT"))
    return `${hi}thank you so much for your kind words about OrangeRide. We'll pass them on!`;
  return null;
}
