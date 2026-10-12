// backend/scripts/test-sms-status.ts
//
// Backlog A — SMS delivery status. Pure checks + an in-process run of the
// real route (signature check, form parsing, forward-only status, one alert)
// against an in-memory fake of the tables it touches. No DB, no Twilio.
//
//   SMS_DRY_RUN=true node --env-file=.env -r ts-node/register scripts/test-sms-status.ts
//
// Expect: every line PASS, "ALL PASS" at the end.
import "../src/plugins/database"; // fastify.prisma type (module augmentation only)
import Fastify from "fastify";
import Twilio from "twilio";
import {
  statusesBefore,
  shouldAlert,
  alertText,
} from "../src/services/smsStatus.service";
import {
  maskPhone,
  normaliseUkPhone,
  SMS_STATUS_PATH,
} from "../src/services/sms.service";
import {
  twilioWebhookRoutes,
  isValidTwilioSignature,
} from "../src/routes/twilioWebhooks";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// Test-only values (never real secrets).
process.env.TWILIO_AUTH_TOKEN = "test-auth-token-0000";
process.env.BACKEND_URL = "https://example.test";
process.env.ADMIN_ALERT_PHONE = "+447700900999";
process.env.SMS_DRY_RUN = "true";
const URL = `https://example.test${SMS_STATUS_PATH}`;
const sign = (params: Record<string, string>, url = URL) =>
  Twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, url, params);

// ── 1. Pure rules ──────────────────────────────────────────────────────────
check(
  "delivered may replace sent/queued",
  statusesBefore("delivered").includes("sent") &&
    statusesBefore("delivered").includes("queued")
);
check(
  "late 'sent' can't overwrite delivered/undelivered",
  !statusesBefore("sent").includes("delivered") &&
    !statusesBefore("sent").includes("undelivered")
);
check(
  "delivered can't overwrite undelivered (and vice versa)",
  !statusesBefore("delivered").includes("undelivered") &&
    !statusesBefore("undelivered").includes("delivered")
);
check(
  "alert rules",
  shouldAlert("FLIGHT_PASSENGER", "RUNNING_LATE") &&
    shouldAlert("FLIGHT_DRIVER_BACKUP", "ARRIVED") &&
    !shouldAlert("FLIGHT_DRIVER_BACKUP", "CANCELLED") &&
    !shouldAlert("OTP", null) &&
    !shouldAlert("ADMIN_ALERT", null)
);
const text = alertText({
  purpose: "FLIGHT_PASSENGER",
  status: "undelivered",
  errorCode: "30005",
  toLast4: "1234",
  reference: "DSMV55X0PZ9ZH",
  flightNumber: "EZY8182",
  eventType: "RUNNING_LATE",
});
check(
  "alert text ASCII, one segment",
  /^[\x20-\x7E]+$/.test(text) && text.length <= 160,
  text
);
check(
  "phone helpers",
  maskPhone("+447700900123") === "***0123" &&
    normaliseUkPhone("07700 900123") === "+447700900123" &&
    normaliseUkPhone("447700900123") === "+447700900123" &&
    normaliseUkPhone("+15551234567") === "+15551234567"
);

// ── 2. Signature ───────────────────────────────────────────────────────────
const p = { MessageSid: "SM1", MessageStatus: "delivered" };
check("valid signature accepted", isValidTwilioSignature(sign(p), p));
check(
  "tampered params rejected",
  !isValidTwilioSignature(sign(p), { ...p, MessageStatus: "failed" })
);
check(
  "signature for another URL rejected",
  !isValidTwilioSignature(sign(p, "https://evil.test" + SMS_STATUS_PATH), p)
);
check("missing signature rejected", !isValidTwilioSignature(undefined, p));

// ── 3. Route, end to end, with an in-memory fake DB ────────────────────────
type Row = {
  sid: string;
  purpose: string;
  bookingId: string | null;
  flightEventId: string | null;
  toLast4: string;
  status: string;
  errorCode: string | null;
  alertedAt: Date | null;
};
const rows = new Map<string, Row>();
rows.set("SMPASS", {
  sid: "SMPASS",
  purpose: "FLIGHT_PASSENGER",
  bookingId: "b1",
  flightEventId: "e1",
  toLast4: "1234",
  status: "queued",
  errorCode: null,
  alertedAt: null,
});
rows.set("SMOTP", {
  sid: "SMOTP",
  purpose: "OTP",
  bookingId: null,
  flightEventId: null,
  toLast4: "5678",
  status: "queued",
  errorCode: null,
  alertedAt: null,
});

const fakePrisma: any = {
  smsMessage: {
    async updateMany({ where, data }: any) {
      const r = rows.get(where.sid);
      if (!r) return { count: 0 };
      if (where.status && !where.status.in.includes(r.status))
        return { count: 0 };
      if ("alertedAt" in where && r.alertedAt !== where.alertedAt)
        return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    },
    async findUnique({ where }: any) {
      return rows.get(where.sid) ?? null;
    },
  },
  bookingFlightEvent: {
    async findUnique() {
      return {
        type: "RUNNING_LATE",
        booking: { reference: "DSMTEST", flightNumber: "EZY8182" },
      };
    },
  },
  booking: { async findUnique() { return null; } },
};

// Count admin alerts (dry-run SMS with purpose ADMIN_ALERT).
let alerts = 0;
const origLog = console.log;
console.log = (...a: any[]) => {
  if (String(a[0]).includes("[SMS dry-run] ADMIN_ALERT")) alerts++;
  origLog(...a);
};

async function main() {
  const app = Fastify({ logger: false });
  app.decorate("prisma", fakePrisma);
  await app.register(twilioWebhookRoutes);
  await app.ready();

  const post = (params: Record<string, string>, signature?: string) =>
    app.inject({
      method: "POST",
      url: SMS_STATUS_PATH,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(signature !== undefined && { "x-twilio-signature": signature }),
      },
      payload: new URLSearchParams(params).toString(),
    });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  const bad = await post({ MessageSid: "SMPASS", MessageStatus: "failed" }, "nope");
  await settle();
  check("bad signature → 403, row untouched",
    bad.statusCode === 403 && rows.get("SMPASS")!.status === "queued");

  const seq: Record<string, string>[] = [
    { MessageSid: "SMPASS", MessageStatus: "sent" },
    { MessageSid: "SMPASS", MessageStatus: "undelivered", ErrorCode: "30005" },
    { MessageSid: "SMPASS", MessageStatus: "undelivered", ErrorCode: "30005" }, // duplicate
    { MessageSid: "SMPASS", MessageStatus: "sent" }, // out of order
  ];
  let all200 = true;
  for (const s of seq) {
    const res = await post(s, sign(s));
    all200 &&= res.statusCode === 200;
    await settle();
  }
  const r = rows.get("SMPASS")!;
  check("valid callbacks → 200", all200);
  check("final status undelivered + code kept",
    r.status === "undelivered" && r.errorCode === "30005", `${r.status} ${r.errorCode}`);
  check("exactly one admin alert", alerts === 1, `alerts=${alerts}`);

  const otp = { MessageSid: "SMOTP", MessageStatus: "failed", ErrorCode: "30003" };
  await post(otp, sign(otp));
  await settle();
  check("OTP failure recorded, no alert",
    rows.get("SMOTP")!.status === "failed" && alerts === 1);

  await app.close();
  console.log = origLog;
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.log = origLog;
  console.error(err);
  process.exit(1);
});
