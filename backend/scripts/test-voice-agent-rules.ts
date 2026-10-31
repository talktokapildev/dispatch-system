// Pure checks for Araa's rules (services/voiceAgentRules.ts). No DB, no network.
// node -r ts-node/register scripts/test-voice-agent-rules.ts
import {
  DEFAULT_GREETING,
  VOICE_DEFAULTS,
  VOICE_KEYS,
  alertText,
  buildInstructions,
  callerText,
  greetingFor,
  isOpen,
  parseHours,
  parseVoiceSettings,
  speechMs,
  toolsFor,
  ukParts,
} from "../src/services/voiceAgentRules";

let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}`, ok ? "" : JSON.stringify(d ?? ""));
};

// Settings
const empty = parseVoiceSettings([]);
check("defaults: always on, marin, 24h notice, Kapil's mobile", empty.mode === "ALWAYS" && empty.voice === "marin" && empty.minNoticeHours === 24 && empty.alertPhone === "+447398341839", empty);
const custom = parseVoiceSettings([
  { key: VOICE_KEYS.mode, value: "hours" },
  { key: VOICE_KEYS.hours, value: "06:00-23:00" },
  { key: VOICE_KEYS.voice, value: "Shimmer" },
  { key: VOICE_KEYS.minNoticeHours, value: "2" },
  { key: VOICE_KEYS.alertPhone, value: "+447700900123" },
]);
check("custom settings read", custom.mode === "HOURS" && custom.voice === "shimmer" && custom.minNoticeHours === 2 && custom.alertPhone === "+447700900123", custom);
const junk = parseVoiceSettings([
  { key: VOICE_KEYS.mode, value: "sometimes" },
  { key: VOICE_KEYS.hours, value: "6pm till late" },
  { key: VOICE_KEYS.voice, value: "darth" },
  { key: VOICE_KEYS.minNoticeHours, value: "-5" },
  { key: VOICE_KEYS.alertPhone, value: "07398" },
]);
check("invalid settings fall back to defaults", JSON.stringify(junk) === JSON.stringify(VOICE_DEFAULTS), junk);

// Hours
check("parse hours", JSON.stringify(parseHours("06:00-23:00")) === "[360,1380]" && parseHours("6:00 - 2:30")![1] === 150);
check("bad hours", parseHours("25:00-26:00") === null && parseHours("08:00-08:00") === null && parseHours("x") === null);
// Clocks went back on 25 Oct 2026, so on 30 Oct UK time = UTC; 1 July is BST (UTC+1).
const at = (iso: string) => new Date(iso);
check("UK parts (winter)", ukParts(at("2026-10-30T08:41:00Z")).minutes === 8 * 60 + 41);
check("UK parts (summer, BST)", ukParts(at("2026-07-01T08:41:00Z")).minutes === 9 * 60 + 41);
const hours = { mode: "HOURS" as const, hours: "06:00-23:00" };
check("open at 08:41", isOpen(hours, at("2026-10-30T08:41:00Z")));
check("closed at 23:30", !isOpen(hours, at("2026-10-30T23:30:00Z")));
check("closed at 05:59", !isOpen(hours, at("2026-10-30T05:59:00Z")));
const overnight = { mode: "HOURS" as const, hours: "18:00-02:00" };
check("overnight window: 01:00 open, 12:00 closed", isOpen(overnight, at("2026-10-30T01:00:00Z")) && !isOpen(overnight, at("2026-10-30T12:00:00Z")));
check("ALWAYS / OFF", isOpen({ mode: "ALWAYS", hours: "x" }, at("2026-10-30T03:00:00Z")) && !isOpen({ mode: "OFF", hours: "" }, at("2026-10-30T12:00:00Z")));

// Greeting + script
const kapil = { firstName: "Kapil", recentTrips: [{ pickup: "Gatwick North Terminal: Car Park 6", dropoff: "Brighton station", when: "17 Oct 2026" }], savedAddresses: ["Home: 7 Riverside Walk"] };
check("known caller greeted by name", greetingFor(empty, kapil, true).startsWith("Hi Kapil, lovely to hear from you again!"));
check("unknown caller gets configured greeting", greetingFor(empty, null, true) === DEFAULT_GREETING);
check("placeholder name not used", greetingFor(empty, { ...kapil, firstName: "Unknown" }, true) === DEFAULT_GREETING);
check("closed greeting offers a message", /take a message/.test(greetingFor(empty, null, false)));
const now = at("2026-10-30T08:41:00Z");
const script = buildInstructions({ now, settings: empty, caller: kapil, callerNumber: "+447587545986", open: true });
check("script has today's date", /Friday,? 30 October 2026/.test(script) && script.includes("08:41"), script.slice(0, 300));
check("script personal: name, recent trip, saved address", script.includes("Kapil") && script.includes("Brighton station") && script.includes("7 Riverside Walk"));
check("script: Gatwick asks terminal, flight optional", /North or South Terminal/.test(script) && /don't\s+have it,\s+that's absolutely fine/.test(script));
check("script: notice hours from settings", buildInstructions({ now, settings: custom, caller: null, callerNumber: null, open: true }).includes("2 hours' notice"));
check("script: withheld number asks for a mobile", buildInstructions({ now, settings: empty, caller: null, callerNumber: null, open: true }).includes("number is withheld"));
const closed = buildInstructions({ now, settings: empty, caller: null, callerNumber: "+447700900123", open: false });
check("closed script: no bookings", /don't take bookings/.test(closed) && !closed.includes("get_quote"));

// Tools
const names = (o: boolean) => toolsFor(o).map((t) => t.name).join(",");
check("open tools", names(true) === "find_place,gatwick_terminal,get_quote,create_booking,find_my_trips,report_feedback,report_lost_property,take_message,end_call", names(true));
check("closed tools: reports + message, no booking", names(false) === "find_my_trips,report_feedback,report_lost_property,take_message,end_call", names(false));
const cb: any = toolsFor(true).find((t) => t.name === "create_booking");
check("create_booking requires cash or card", cb.parameters.required.includes("payment") && cb.parameters.properties.payment.enum.join() === "CASH,CARD");
check("script: asks cash or card, never card details", /cash or card on the day/.test(script) && /never ask for them/.test(script));

// FAQ
const withFaq = parseVoiceSettings([{ key: VOICE_KEYS.faq, value: "Child seats: on request, free." }]);
const faqScript = buildInstructions({ now, settings: withFaq, caller: null, callerNumber: "+447911123456", open: true });
check("FAQ in the script, answer only from it", faqScript.includes("Child seats: on request, free.") && /answer ONLY from/.test(faqScript));
check("no FAQ: questions become messages", /say you're not sure\s+and offer to take a message/.test(script));
check("FAQ capped", parseVoiceSettings([{ key: VOICE_KEYS.faq, value: "x".repeat(5000) }]).faq.length === 3000);
check("script: complaints handled kindly, 999, no promises", /call 999/.test(script) && /promise refunds/.test(script) && /report_feedback/.test(script) && /report_lost_property/.test(script));
check("closed script still handles complaints", closed.includes("report_feedback") && closed.includes("Don't take bookings") === false && /closed for bookings/.test(closed));

// Speech time
check("speech time grows with text, capped", speechMs("Bye!") < speechMs("Thank you so much, Kapil. We'll text you shortly to confirm. Have a lovely day, goodbye!") && speechMs("x".repeat(5000)) === 15000);

// Texts
const booked = {
  outcome: "BOOKED",
  fromNumber: "+447587545986",
  callerName: "Kapil",
  durationSeconds: 150,
  booking: { id: "b1", reference: "DSABC123", when: at("2026-10-31T15:30:00Z"), pickup: "Gatwick North Terminal: Car Park 6, Level 4", dropoff: "Brighton Railway Station", fare: 67.42, passengers: 1 },
};
const alert = alertText(booked);
check("alert: booking with approve link", alert.includes("new booking request") && alert.includes("£67.42") && alert.includes("/bookings?open=b1") && alert.includes("Sat 31 Oct, 15:30"), alert);
check("caller text: request, ref, will confirm", (callerText(booked) ?? "").includes("ref DSABC123") && (callerText(booked) ?? "").includes("We'll text you shortly to confirm"));
const msg = { outcome: "MESSAGE", fromNumber: null, callerName: "Sam", durationSeconds: 40, message: "Lost a phone in the car (call back on +447700900123)" };
check("alert: message, withheld number", alertText(msg).includes("withheld number") && alertText(msg).includes("Lost a phone"));
check("no caller text when nothing happened", callerText({ outcome: "NO_BOOKING", fromNumber: "+447700900123", callerName: null, durationSeconds: 20 }) === null);
check("too soon: alert with trip, caller told we'll call back", alertText({ outcome: "TOO_SOON", fromNumber: "+447700900123", callerName: null, durationSeconds: 60, quote: { when: at("2026-10-30T12:00:00Z"), pickup: "Crawley", dropoff: "Gatwick South", fare: 20 } }).includes("too soon") && (callerText({ outcome: "TOO_SOON", fromNumber: "x", callerName: null, durationSeconds: 1 }) ?? "").includes("call you back"));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
