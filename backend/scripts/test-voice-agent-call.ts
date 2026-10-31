// Simulated phone calls through Araa's real call code (services/voiceAgent.service.ts), with fake
// OpenAI (call control + realtime socket), Google, pricing, SMS and database. No network.
// SMS_DRY_RUN=true DATABASE_URL=postgres://x JWT_SECRET=x node -r ts-node/register scripts/test-voice-agent-call.ts
import { EventEmitter } from "node:events";
import { handleIncomingCall, activeCallCount, callerNumber, type VoiceDeps } from "../src/services/voiceAgent.service";

let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}`, ok ? "" : JSON.stringify(d ?? "").slice(0, 600));
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ─── Fakes ───
class FakeWs extends EventEmitter {
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.emit("close");
  }
  server(ev: Record<string, unknown>) {
    this.emit("message", Buffer.from(JSON.stringify(ev)));
  }
}

function makeWorld(opts: { settings?: { key: string; value: string }[]; knownCaller?: boolean } = {}) {
  const w = {
    accepted: [] as any[],
    rejected: [] as any[],
    hungUp: [] as string[],
    sms: [] as { to: string; body: string }[],
    calls: new Map<string, any>(),
    bookings: [] as any[],
    users: new Map<string, any>(),
    history: [] as any[],
    ws: null as FakeWs | null,
    directionsCalls: 0,
    complaints: [] as any[],
    lost: [] as any[],
    notes: [] as any[],
    alerts: [] as string[],
  };
  // Kapil's past trips (for find_my_trips / linking reports)
  const pastTrips = [
    { id: "trip-old", reference: "DSOLD1", passengerId: "p-kapil", driverId: "d-nasir", vehicleId: "v-lm71", status: "COMPLETED", scheduledAt: new Date("2026-10-28T06:00:00Z"), completedAt: new Date("2026-10-28T06:40:00Z"), createdAt: new Date("2026-10-27T10:00:00Z"), pickupAddress: "Gatwick North Terminal: Car Park 6, Level 4", dropoffAddress: "7 Riverside Walk, Crawley", driver: { user: { firstName: "Nasir", lastName: "Kazmi" } }, vehicle: { licensePlate: "LM71GVW" }, passenger: { user: { firstName: "Kapil", lastName: "Dev", phone: "+447587545986" } } },
    { id: "trip-older", reference: "DSOLD2", passengerId: "p-kapil", driverId: null, vehicleId: null, status: "CANCELLED", scheduledAt: new Date("2026-10-20T09:00:00Z"), completedAt: null, createdAt: new Date("2026-10-19T10:00:00Z"), pickupAddress: "Crawley", dropoffAddress: "Gatwick South Terminal", driver: null, vehicle: null, passenger: { user: { firstName: "Kapil", lastName: "Dev", phone: "+447587545986" } } },
  ];
  if (opts.knownCaller !== false)
    w.users.set("+447587545986", { id: "u1", phone: "+447587545986", firstName: "Kapil", lastName: "Dev", passenger: { id: "p-kapil" } });
  const redisStore = new Map<string, string>();
  const prisma: any = {
    systemSetting: { findMany: async () => opts.settings ?? [] },
    passenger: {
      findFirst: async ({ where }: any) => {
        const u = w.users.get(where.user.phone);
        return u
          ? {
              id: u.passenger.id,
              savedAddresses: [{ label: "Home", address: "7 Riverside Walk, Crawley" }],
              user: { firstName: u.firstName },
              bookings: [{ pickupAddress: "Gatwick North Terminal: Car Park 6", dropoffAddress: "Brighton Railway Station", scheduledAt: new Date("2026-10-17T12:00:00Z"), createdAt: new Date("2026-10-16T12:00:00Z") }],
            }
          : null;
      },
      create: async () => ({ id: "p-new" }),
    },
    user: {
      findUnique: async ({ where }: any) => w.users.get(where.phone) ?? null,
      update: async () => ({}),
      create: async ({ data }: any) => {
        const u = { id: "u-new", ...data, passenger: { id: "p-new" } };
        w.users.set(data.phone, u);
        return u;
      },
    },
    voiceCall: {
      create: async ({ data }: any) => {
        const r = { id: `vc${w.calls.size + 1}`, ...data };
        w.calls.set(r.id, r);
        return r;
      },
      update: async ({ where, data }: any) => Object.assign(w.calls.get(where.id), data),
    },
    airportMeetingPoint: {
      findFirst: async ({ where }: any) =>
        where.terminal === "NORTH"
          ? { id: "mp-north", name: "Car Park 6, Level 4", terminal: "NORTH", latitude: 51.1626, longitude: -0.1773 }
          : { id: "mp-south", name: "Orange Car Park, Level 3", terminal: "SOUTH", latitude: 51.1563, longitude: -0.1611 },
    },
    booking: {
      create: async ({ data }: any) => {
        const b = { id: `b${w.bookings.length + 1}`, ...data };
        w.bookings.push(b);
        return b;
      },
    },
    bookingStatusHistory: { create: async ({ data }: any) => w.history.push(data) },
    $transaction: async (fn: any) => fn(prisma),
    $executeRawUnsafe: async () => 1,
    complaint: {
      findMany: async () => w.complaints.map((c) => ({ refNo: c.refNo })),
      create: async ({ data }: any) => {
        const c = { id: `cc${w.complaints.length + 1}`, ...data };
        w.complaints.push(c);
        return c;
      },
    },
    complaintContact: { create: async ({ data }: any) => w.notes.push(data) },
    lostProperty: {
      findMany: async () => w.lost.map((c) => ({ refNo: c.refNo })),
      create: async ({ data }: any) => {
        const c = { id: `lp${w.lost.length + 1}`, ...data };
        w.lost.push(c);
        return c;
      },
    },
    lostPropertyContact: { create: async ({ data }: any) => w.notes.push(data) },
  };
  prisma.booking.findMany = async ({ where }: any) => pastTrips.filter((t) => t.passengerId === where.passengerId);
  prisma.booking.findUnique = async ({ where }: any) => pastTrips.find((t) => t.id === where.id || t.reference === where.reference) ?? null;
  const redis: any = {
    get: async (k: string) => redisStore.get(k) ?? null,
    set: async (k: string, v: string) => redisStore.set(k, v),
    incr: async (k: string) => {
      const n = Number(redisStore.get(k) ?? 0) + 1;
      redisStore.set(k, String(n));
      return n;
    },
    expire: async () => 1,
  };
  const deps: VoiceDeps = {
    prisma,
    redis,
    log: { info: () => {}, warn: () => {}, error: (...a: any[]) => console.error("[log.error]", ...a) },
    io: { to: () => ({ emit: () => {} }) },
    calls: {
      accept: async (id, body) => w.accepted.push({ id, body }),
      reject: async (id, body) => w.rejected.push({ id, body }),
      hangup: async (id) => {
        w.hungUp.push(id);
        setTimeout(() => w.ws?.close(), 5);
      },
    },
    connect: () => {
      w.ws = new FakeWs();
      setTimeout(() => w.ws!.emit("open"), 1);
      return w.ws as any;
    },
    maps: {
      autocomplete: async (q: string) =>
        /brighton/i.test(q)
          ? ([
              { placeId: "pl-brighton-stn", mainText: "Brighton Railway Station", secondaryText: "Queens Road, Brighton" },
              { placeId: "pl-station-st", mainText: "Station Street", secondaryText: "Brighton" },
            ] as any)
          : /edinburgh/i.test(q)
            ? ([{ placeId: "pl-edi", mainText: "Edinburgh Waverley", secondaryText: "Edinburgh" }] as any)
            : /glasgow/i.test(q)
              ? ([{ placeId: "pl-gla", mainText: "Glasgow Central", secondaryText: "Glasgow" }] as any)
              : [],
      getPlaceDetails: async (id: string) =>
        (id === "pl-edi"
          ? { address: "Edinburgh Waverley, Edinburgh EH1 1BB, UK", latitude: 55.952, longitude: -3.189 }
          : id === "pl-gla"
            ? { address: "Glasgow Central, Glasgow G1 3SL, UK", latitude: 55.859, longitude: -4.258 }
            : { address: "Brighton Railway Station, Brighton BN1 3XP, UK", latitude: 50.829, longitude: -0.141 }) as any,
      getDirections: async () => {
        w.directionsCalls++;
        return { distanceKm: 47.3, durationMinutes: 50, polyline: "" } as any;
      },
    },
    pricing: { estimateFare: async () => ({ total: 67.42, timePremiumAmount: 0, timePremiumLabel: "" }) as any },
    sendSms: async (to: string, body: string) => {
      w.sms.push({ to, body });
      return { ok: true };
    },
    now: () => new Date("2026-10-30T08:41:00Z"),
  };
  return { w, deps };
}

/** The model calls some tools, then its reply finishes. */
async function modelCalls(w: any, calls: { name: string; args: Record<string, unknown> }[]) {
  const before = w.ws.sent.length;
  calls.forEach((c, i) =>
    w.ws.server({ type: "response.function_call_arguments.done", call_id: `fc_${c.name}_${i}_${Math.random()}`, name: c.name, arguments: JSON.stringify(c.args) })
  );
  w.ws.server({ type: "response.done" });
  await tick(30);
  const out = w.ws.sent.slice(before);
  return {
    outputs: out.filter((e: any) => e.type === "conversation.item.create").map((e: any) => JSON.parse(e.item.output)),
    creates: out.filter((e: any) => e.type === "response.create"),
  };
}

const sipFrom = (n: string) => [{ name: "From", value: `"Caller" <sip:${n}@pstn.twilio.com>;tag=abc` }];

async function main() {
  // ─── caller number parsing ───
  check("caller number from SIP From header", callerNumber(sipFrom("+447587545986")) === "+447587545986");
  check("withheld number → null", callerNumber([{ name: "From", value: "<sip:anonymous@anonymous.invalid>" }]) === null);
  check("00-prefixed number normalised", callerNumber(sipFrom("00447587545986")) === "+447587545986");
  check("unrecognised but well-formed number kept", callerNumber(sipFrom("+447700900123")) === "+447700900123");

  // ─── 1. Known caller books Gatwick North → Brighton for tomorrow ───
  {
    const { w, deps } = makeWorld();
    await handleIncomingCall(deps, { call_id: "rtc_test1", sip_headers: sipFrom("+447587545986") });
    await tick(10);
    const acc = w.accepted[0];
    check("call accepted with model, voice marin, transcription", acc?.body?.model === "gpt-realtime-2.1" && acc.body.audio.output.voice === "marin" && acc.body.audio.input.transcription.model === "gpt-4o-transcribe", acc?.body);
    check("script personalised for Kapil, with today's date", acc.body.instructions.includes("The caller is Kapil") && /30 October 2026/.test(acc.body.instructions));
    check("all nine tools offered", acc.body.tools.length === 9);
    const greet = w.ws!.sent[0];
    check("greets Kapil by name", greet?.type === "response.create" && greet.response.instructions.includes("Hi Kapil, lovely to hear from you again!"), greet);
    check("one active call", activeCallCount() === 1);

    w.ws!.server({ type: "conversation.item.input_audio_transcription.completed", transcript: "I need a taxi tomorrow at half three from Gatwick North to Brighton station." });

    // Two lookups in one reply → two outputs, ONE continue (fix #3)
    let r = await modelCalls(w, [
      { name: "gatwick_terminal", args: { terminal: "NORTH" } },
      { name: "find_place", args: { query: "Brighton station" } },
    ]);
    check("parallel tools: 2 outputs, exactly 1 continue", r.outputs.length === 2 && r.creates.length === 1, r);
    check("Gatwick North → meeting point", r.outputs[0].id === "gatwick_north" && r.outputs[0].meeting_point === "Car Park 6, Level 4", r.outputs[0]);
    check("Brighton lookup → matches with ids", r.outputs[1].matches?.[0]?.id === "p1" && r.outputs[1].matches[0].name === "Brighton Railway Station", r.outputs[1]);

    r = await modelCalls(w, [{ name: "find_place", args: { query: "Gatwick airport south terminal" } }]);
    check("find_place refuses Gatwick (use terminal tool)", r.outputs[0].matches.length === 0 && /gatwick_terminal/.test(r.outputs[0].note), r.outputs[0]);

    r = await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "gatwick_north", destination_id: "p1", date: "2026-10-31", time: "15:30", passengers: 1, suitcases: 2 } }]);
    const q = r.outputs[0];
    check("quote: real pricing, exact fare, not too soon", q.fare === "£67.42" && q.too_soon === false && q.quote_id === "q1" && q.miles > 29 && q.miles < 30, q);

    r = await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "gatwick_north", destination_id: "p1", date: "2026-10-31", time: "15:30", passengers: 1, suitcases: 2 } }]);
    check("route cached: second quote makes no new Directions call", w.directionsCalls === 1, w.directionsCalls);

    r = await modelCalls(w, [{ name: "create_booking", args: { quote_id: "q1", name: "Kapil Dev", flight_number: "ezy 8004", payment: "CARD" } }]);
    const b = w.bookings[0];
    check("booking saved: ref returned", r.outputs[0].saved === true && /^DS/.test(r.outputs[0].reference), r.outputs[0]);
    check("booking waits for approval: CONFIRMED + on hold, no dispatcher", b.status === "CONFIRMED" && b.isOnHold === true && b.dispatchedBy === undefined, b);
    check("booking: airport pickup at North meeting point", b.type === "AIRPORT_PICKUP" && b.meetingPointId === "mp-north" && b.terminal === "NORTH" && b.pickupAddress.startsWith("Gatwick North Terminal: Car Park 6"), b);
    check("booking: fare = quoted fare, time, pax, existing passenger", b.estimatedFare === 67.42 && b.scheduledAt.toISOString() === "2026-10-31T15:30:00.000Z" && b.passengerCount === 1 && b.passengerId === "p-kapil", b);
    check("booking: TfL fields (booked via phone, when)", b.bookedVia === "PHONE" && b.bookedAt.toISOString() === "2026-10-30T08:41:00.000Z");
    check("booking: flight normalised, suitcases in notes", b.flightNumber === "EZY8004" && b.notes.includes("2 suitcases"), b);
    check("booking: card in the car noted, still collected by the driver (CASH)", b.paymentMethod === "CASH" && b.notes.includes("card in the car") && b.operatorNotes.includes("Pays by card in the car") && !b.operatorNotes.includes("not discussed"), b);
    check("booking: luggage type for the flight check", b.luggageType === "CHECKED", b.luggageType);
    check("status history written", w.history[0]?.status === "CONFIRMED");

    r = await modelCalls(w, [{ name: "create_booking", args: { quote_id: "q1", name: "Kapil" } }]);
    check("no double booking on one call", !!r.outputs[0].error && w.bookings.length === 1);

    // end_call → goodbye requested (tools off) → hang up after it's spoken (fix #2)
    r = await modelCalls(w, [{ name: "end_call", args: {} }]);
    check("end_call asks for a goodbye with tools off", r.creates.length === 1 && r.creates[0].response.tool_choice === "none" && /goodbye/.test(r.creates[0].response.instructions) && /text to confirm/.test(r.creates[0].response.instructions), r.creates);
    check("not hung up before the goodbye", w.hungUp.length === 0);
    w.ws!.server({ type: "response.output_audio_transcript.done", transcript: "Thanks Kapil, we'll text you shortly to confirm. Have a lovely day, bye!" });
    w.ws!.server({ type: "response.done" });
    await tick(500);
    check("still talking: not hung up yet", w.hungUp.length === 0);
    await tick(7000);
    check("hung up after the goodbye", w.hungUp[0] === "rtc_test1");
    await tick(50);

    const call = [...w.calls.values()][0];
    check("call record: BOOKED, linked, duration, transcript", call.outcome === "BOOKED" && call.bookingId === "b1" && typeof call.durationSeconds === "number" && call.transcript.some((l: any) => l.who === "caller") && call.transcript.some((l: any) => l.who === "araa"), call);
    check("call record: quote saved", call.quote?.fare === 67.42);
    const alert = w.sms.find((s) => s.to === "+447398341839");
    check("Kapil texted with approve link", !!alert && alert.body.includes("new booking request") && alert.body.includes("/bookings?open=b1") && alert.body.includes("£67.42"), alert);
    const toCaller = w.sms.find((s) => s.to === "+447587545986");
    check("caller texted: request received, will confirm", !!toCaller && toCaller.body.includes("We'll text you shortly to confirm") && toCaller.body.includes(b.reference), toCaller);
    check("call released", activeCallCount() === 0);
  }

  // ─── 2. Unknown caller, too soon → no booking, message taken ───
  {
    const { w, deps } = makeWorld({ knownCaller: false });
    await handleIncomingCall(deps, { call_id: "rtc_test2", sip_headers: sipFrom("+447911654321") });
    await tick(10);
    check("unknown caller: standard greeting", w.ws!.sent[0].response.instructions.includes("I'm Araa, the virtual assistant"));
    await modelCalls(w, [
      { name: "gatwick_terminal", args: { terminal: "SOUTH" } },
      { name: "find_place", args: { query: "Brighton station" } },
    ]);
    let r = await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "p1", destination_id: "gatwick_south", date: "2026-10-30", time: "18:00", passengers: 2, suitcases: 1 } }]);
    check("today 18:00 is too soon (24h rule)", r.outputs[0].too_soon === true && r.outputs[0].minimum_notice_hours === 24, r.outputs[0]);
    r = await modelCalls(w, [{ name: "create_booking", args: { quote_id: "q1", name: "Sam Jones" } }]);
    check("too soon: booking refused", !!r.outputs[0].error && w.bookings.length === 0, r.outputs[0]);
    r = await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "p1", destination_id: "gatwick_south", date: "2026-10-30", time: "07:00", passengers: 1, suitcases: 0 } }]);
    check("a time already passed is refused", /passed/.test(r.outputs[0].error ?? ""), r.outputs[0]);
    r = await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "p1", destination_id: "gatwick_south", date: "2026-11-02", time: "09:00", passengers: 6, suitcases: 0 } }]);
    check("more than 4 passengers refused", /up to 4/.test(r.outputs[0].error ?? ""), r.outputs[0]);
    await modelCalls(w, [{ name: "take_message", args: { name: "Sam Jones", about: "Wants a Brighton to Gatwick South pickup at 6pm today" } }]);
    w.ws!.server({ type: "conversation.item.input_audio_transcription.completed", transcript: "Okay thanks." });
    await modelCalls(w, [{ name: "end_call", args: {} }]);
    w.ws!.server({ type: "response.output_audio_transcript.done", transcript: "Bye!" });
    w.ws!.server({ type: "response.done" });
    await tick(2000);
    const call = [...w.calls.values()][0];
    check("outcome TOO_SOON with message", call.outcome === "TOO_SOON" && call.message.includes("6pm today") && call.callerName === "Sam Jones", call);
    const alert = w.sms.find((s) => s.to === "+447398341839");
    check("Kapil told: too soon, message, call back", !!alert && /too soon/.test(alert.body) && alert.body.includes("6pm today"), alert);
    check("caller told we'll call back", w.sms.some((s) => s.to === "+447911654321" && s.body.includes("call you back")));
  }

  // ─── 3. Out of area ───
  {
    const { w, deps } = makeWorld();
    await handleIncomingCall(deps, { call_id: "rtc_test3", sip_headers: sipFrom("+447587545986") });
    await tick(10);
    await modelCalls(w, [
      { name: "find_place", args: { query: "Edinburgh Waverley" } },
      { name: "find_place", args: { query: "Glasgow Central" } },
    ]);
    const r = await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "p1", destination_id: "p2", date: "2026-11-03", time: "10:00", passengers: 1, suitcases: 0 } }]);
    check("Edinburgh → Glasgow: out of area, no Directions call", r.outputs[0].out_of_area === true && w.directionsCalls === 0, r.outputs[0]);
    w.ws!.close();
    await tick(20);
  }

  // ─── 4. Switched off → call rejected ───
  {
    const { w, deps } = makeWorld({ settings: [{ key: "voiceAgentMode", value: "OFF" }] });
    await handleIncomingCall(deps, { call_id: "rtc_test4", sip_headers: sipFrom("+447587545986") });
    check("OFF: call rejected (486), not accepted, logged", w.rejected[0]?.body?.status_code === 486 && w.accepted.length === 0 && [...w.calls.values()][0]?.outcome === "REJECTED");
  }

  // ─── 5. Outside hours → message only ───
  {
    const { w, deps } = makeWorld({ settings: [{ key: "voiceAgentMode", value: "HOURS" }, { key: "voiceAgentHours", value: "09:00-17:00" }] });
    await handleIncomingCall(deps, { call_id: "rtc_test5", sip_headers: sipFrom("+447587545986") });
    await tick(10);
    const acc = w.accepted[0];
    check("outside hours (08:41 vs 09:00-17:00): message tools only", acc.body.tools.map((t: any) => t.name).join() === "find_my_trips,report_feedback,report_lost_property,take_message,end_call" && /closed for bookings/.test(w.ws!.sent[0].response.instructions), acc.body.tools);
    w.ws!.close();
    await tick(20);
  }

  // ─── 6. Withheld number: asks for a mobile before booking ───
  {
    const { w, deps } = makeWorld();
    await handleIncomingCall(deps, { call_id: "rtc_test6", sip_headers: [{ name: "From", value: "<sip:anonymous@anonymous.invalid>" }] });
    await tick(10);
    await modelCalls(w, [{ name: "gatwick_terminal", args: { terminal: "NORTH" } }, { name: "find_place", args: { query: "Brighton station" } }]);
    await modelCalls(w, [{ name: "get_quote", args: { pickup_id: "gatwick_north", destination_id: "p1", date: "2026-11-05", time: "09:00", passengers: 1, suitcases: 0 } }]);
    let r = await modelCalls(w, [{ name: "create_booking", args: { quote_id: "q1", name: "Alex Smith" } }]);
    check("withheld: booking needs a mobile number", /mobile number/.test(r.outputs[0].error ?? "") && w.bookings.length === 0, r.outputs[0]);
    r = await modelCalls(w, [{ name: "create_booking", args: { quote_id: "q1", name: "Alex Smith", phone: "07911 123456" } }]);
    check("withheld: new passenger created with the number given", r.outputs[0].saved === true && w.users.has("+447911123456") && w.bookings[0].passengerId === "p-new", r.outputs[0]);
    w.ws!.close();
    await tick(30);
    const call = [...w.calls.values()][0];
    check("withheld caller: no caller SMS to an unknown number, Kapil still texted", !w.sms.some((s) => s.to !== "+447398341839") && w.sms.length === 1 && call.outcome === "BOOKED", w.sms);
  }

  // ─── 7. Known caller: complaint about a past trip ───
  {
    const { w, deps } = makeWorld();
    await handleIncomingCall(deps, { call_id: "rtc_test7", sip_headers: sipFrom("+447587545986") });
    await tick(10);
    const tools = w.accepted[0].body.tools.map((t: any) => t.name).join();
    check("open call offers report tools too", tools.includes("find_my_trips") && tools.includes("report_feedback") && tools.includes("report_lost_property"), tools);
    let r = await modelCalls(w, [{ name: "find_my_trips", args: {} }]);
    const trips = r.outputs[0].trips;
    check("find_my_trips: caller's own trips with ids, newest first", trips?.length === 2 && trips[0].id === "t1" && trips[0].driver === "Nasir" && trips[0].status === "completed" && trips[1].status === "cancelled", r.outputs[0]);
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLAINT", category: "Late arrival", details: "Driver was 25 minutes late at North Terminal on Wednesday morning.", trip_id: "t1", name: "Kapil Dev" } }]);
    const c = w.complaints[0];
    check("complaint recorded with ref, spoken ref, 48h", r.outputs[0].saved === true && r.outputs[0].reference === "CC-2026-001" && r.outputs[0].say_reference_as === "C C, 2026, 1" && r.outputs[0].reply_within_hours === 48, r.outputs[0]);
    check("complaint: PHONE channel, category, linked to the trip, driver and car copied", c.channel === "PHONE" && c.type === "COMPLAINT" && c.category === "Late arrival" && c.bookingId === "trip-old" && c.driverName === "Nasir Kazmi" && c.vehicleReg === "LM71GVW" && c.complainantPhone === "+447587545986", c);
    check("complaint: no staff handler, history note says Araa took it", c.createdByUserId === undefined && w.notes.some((n) => n.complaintId === c.id && n.staffName.startsWith("Araa")), w.notes);
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLAINT", details: "Also rude.", name: "Kapil" } }]);
    check("one complaint per call", !!r.outputs[0].error && w.complaints.length === 1);
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLAINT", details: "x", name: "Kapil" } }]);
    await modelCalls(w, [{ name: "end_call", args: {} }]);
    w.ws!.server({ type: "response.output_audio_transcript.done", transcript: "Bye!" });
    w.ws!.server({ type: "response.done" });
    await tick(2000);
    const call = [...w.calls.values()][0];
    check("call outcome COMPLAINT, ref saved on the call", call.outcome === "COMPLAINT" && call.message.includes("Complaint CC-2026-001"), call);
    const alert = w.sms.find((s) => s.to === "+447398341839");
    check("Kapil texted: complaint ref, summary, Alerts link", !!alert && alert.body.includes("complaint CC-2026-001") && alert.body.includes("Late arrival") && alert.body.includes("/alerts"), alert);
    const toCaller = w.sms.find((s) => s.to === "+447587545986");
    check("caller texted: sorry, ref, 48 hours", !!toCaller && toCaller.body.includes("CC-2026-001") && toCaller.body.includes("48 hours"), toCaller);
  }

  // ─── 8. Lost property, then a compliment, on one call ───
  {
    const { w, deps } = makeWorld();
    await handleIncomingCall(deps, { call_id: "rtc_test8", sip_headers: sipFrom("+447587545986") });
    await tick(10);
    let r = await modelCalls(w, [{ name: "report_lost_property", args: { item: "Black Samsung phone, back seat", name: "Kapil" } }]);
    check("lost property without a trip: recorded, REPORTED, phone from caller ID", r.outputs[0].reference === "LP-2026-001" && w.lost[0].status === "REPORTED" && w.lost[0].contactPhone === "+447587545986" && w.lost[0].bookingId === null, w.lost[0]);
    r = await modelCalls(w, [{ name: "report_lost_property", args: { item: "Umbrella", name: "Kapil" } }]);
    check("one lost-property report per call", !!r.outputs[0].error && w.lost.length === 1);
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLIMENT", details: "Nasir was brilliant and helped with the bags.", name: "Kapil" } }]);
    check("compliment recorded, no category", r.outputs[0].reference === "CC-2026-001" && w.complaints[0].type === "COMPLIMENT" && w.complaints[0].category === null, w.complaints[0]);
    w.ws!.close();
    await tick(30);
    const call = [...w.calls.values()][0];
    check("outcome: lost property outranks compliment; both refs saved", call.outcome === "LOST_PROPERTY" && call.message.includes("LP-2026-001") && call.message.includes("Compliment CC-2026-001"), call);
    const alert = w.sms.find((s) => s.to === "+447398341839")!;
    check("Kapil's text lists both", alert.body.includes("lost property LP-2026-001") && alert.body.includes("compliment CC-2026-001"), alert);
    check("caller told the lost item ref", w.sms.some((s) => s.to === "+447587545986" && s.body.includes("LP-2026-001")));
  }

  // ─── 9. Withheld number: complaint needs a number; unknown caller has no trips ───
  {
    const { w, deps } = makeWorld();
    await handleIncomingCall(deps, { call_id: "rtc_test9", sip_headers: [{ name: "From", value: "<sip:anonymous@anonymous.invalid>" }] });
    await tick(10);
    let r = await modelCalls(w, [{ name: "find_my_trips", args: {} }]);
    check("withheld: no trips, ask when/where", r.outputs[0].trips.length === 0 && /roughly when/.test(r.outputs[0].note));
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLAINT", category: "Overcharged", details: "Charged more than quoted on Friday.", name: "Jo" } }]);
    check("withheld: complaint asks for a number first", /phone number/.test(r.outputs[0].error ?? "") && w.complaints.length === 0, r.outputs[0]);
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLAINT", category: "Overcharged", details: "Charged more than quoted on Friday.", name: "Jo", phone: "07911 123456" } }]);
    check("withheld: recorded with the number given, unlinked, history says check trip", r.outputs[0].saved === true && w.complaints[0].complainantPhone === "+447911123456" && w.complaints[0].bookingId === undefined && w.notes.some((n) => /No booking linked/.test(n.note)), w.complaints[0]);
    r = await modelCalls(w, [{ name: "report_feedback", args: { kind: "COMPLIMENT", details: "Lovely driver, thank you.", name: "Jo", trip_id: "t1" } }]);
    check("a trip id the caller never saw can't link someone else's booking", r.outputs[0].saved === true && w.complaints[1].bookingId === undefined, w.complaints[1]);
    w.ws!.close();
    await tick(30);
  }

  // ─── 10. Closed hours: reports still work, bookings don't ───
  {
    const { w, deps } = makeWorld({ settings: [{ key: "voiceAgentMode", value: "HOURS" }, { key: "voiceAgentHours", value: "09:00-17:00" }] });
    await handleIncomingCall(deps, { call_id: "rtc_test10", sip_headers: sipFrom("+447587545986") });
    await tick(10);
    const names = w.accepted[0].body.tools.map((t: any) => t.name).join();
    check("closed: report tools + message, no booking tools", names === "find_my_trips,report_feedback,report_lost_property,take_message,end_call", names);
    w.ws!.close();
    await tick(20);
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
main();
