// backend/scripts/sms-simulate-callback.ts
//
// End-to-end test of the PRODUCTION status-callback path without needing a
// real undelivered SMS: inserts a temporary SmsMessage row (status "sent"),
// posts a Twilio-signed callback for it to BACKEND_URL, shows the row after
// production processed it, then deletes the row. Sends no SMS itself — but
// production will send the admin alert for FLIGHT_PASSENGER failures.
//
//   DATABASE_URL="$PROD_DB" BACKEND_URL=https://backend-production-baf2.up.railway.app \
//     node --env-file=.env -r ts-node/register scripts/sms-simulate-callback.ts [undelivered|failed|delivered] [errorCode] [PURPOSE]
//
// Needs TWILIO_AUTH_TOKEN in .env (same account as production).
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import Twilio from "twilio";
import { statusCallbackUrl } from "../src/services/sms.service";

async function main() {
  const status = process.argv[2] ?? "undelivered";
  const errorCode = process.argv[3] ?? (status === "delivered" ? "" : "30005");
  const purpose = process.argv[4] ?? "FLIGHT_PASSENGER";
  const url = statusCallbackUrl();
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!url?.startsWith("https://") || !token) {
    console.log("Need BACKEND_URL (public https) and TWILIO_AUTH_TOKEN.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  const sid = `SMsim${randomBytes(14).toString("hex")}`;
  try {
    await prisma.smsMessage.create({
      data: { sid, purpose, toLast4: "0000", status: "sent", sender: "simulated" },
    });

    const params: Record<string, string> = {
      MessageSid: sid,
      MessageStatus: status,
      ...(errorCode && { ErrorCode: errorCode }),
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": Twilio.getExpectedTwilioSignature(token, url, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    console.log(`POST ${url} → HTTP ${res.status}`);

    // Unsigned copy must be refused.
    const bad = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    console.log(`same request, no signature → HTTP ${bad.status} (expect 403)`);

    await new Promise((r) => setTimeout(r, 5000));
    console.log(await prisma.smsMessage.findUnique({ where: { sid } }));
  } finally {
    await prisma.smsMessage.deleteMany({ where: { sid } });
    console.log("temporary row deleted");
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
