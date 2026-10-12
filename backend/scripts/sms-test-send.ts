// backend/scripts/sms-test-send.ts
//
// Sends ONE real SMS through the shared sms.service with delivery tracking on,
// so Twilio calls the PRODUCTION status callback and production records it.
//
//   DATABASE_URL="$PROD_DB" BACKEND_URL=https://backend-production-baf2.up.railway.app \
//     node --env-file=.env -r ts-node/register scripts/sms-test-send.ts <+44…> [TEST|FLIGHT_PASSENGER]
//
//   TEST              (default) recorded + status tracked, never alerts
//   FLIGHT_PASSENGER  same, and alerts ADMIN_ALERT_PHONE (via production) if undelivered
//
// Needs Twilio vars in .env (same account as production). Costs one SMS.
// Then check status with:  scripts/sms-test-send.ts --status <sid>
import { PrismaClient } from "@prisma/client";
import { enableSmsTracking, sendSms, statusCallbackUrl } from "../src/services/sms.service";

async function main() {
  const prisma = new PrismaClient();
  const [a, b] = process.argv.slice(2);
  try {
    if (a === "--status") {
      const row = await prisma.smsMessage.findUnique({ where: { sid: b } });
      console.log(row ?? "not found");
      return;
    }
    if (!a || !/^\+\d{8,15}$/.test(a)) {
      console.log("usage: sms-test-send.ts <+E164> [TEST|FLIGHT_PASSENGER] | --status <sid>");
      process.exitCode = 1;
      return;
    }
    const purpose = b === "FLIGHT_PASSENGER" ? "FLIGHT_PASSENGER" : "TEST";
    const url = statusCallbackUrl();
    if (!url?.startsWith("https://")) {
      console.log(`BACKEND_URL must be the public https URL (got ${url}).`);
      process.exitCode = 1;
      return;
    }
    enableSmsTracking(prisma);
    const r = await sendSms(
      a,
      "OrangeRide test message - delivery tracking check. No action needed.",
      { purpose }
    );
    console.log(r);
    if (r.ok)
      console.log(
        `Callbacks go to ${url}. In ~1 min run:  scripts/sms-test-send.ts --status ${r.sid}`
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
