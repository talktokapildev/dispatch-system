// backend/scripts/document-compliance-report.ts
//
// READ-ONLY. Who would be blocked once DOCUMENT_GATING_ENABLED=true, and why. Also lists
// documents in the 7-day "no expiry date" grace period, and vehicles whose expiry fields
// (Vehicles page) differ from the approved document. Run against prod before switching on:
//
//   DATABASE_URL="$PROD_DB" node -r ts-node/register scripts/document-compliance-report.ts
import { PrismaClient } from "@prisma/client";
import { loadComplianceMany } from "../src/services/documentCompliance.service";
import {
  DOC_LABELS,
  DocType,
  blockMessage,
  ukDateLabel,
} from "../src/services/documentRules";

const prisma = new PrismaClient();
const fmt = (d: Date | null | undefined) => (d ? ukDateLabel(d) : "-");

async function main() {
  const now = new Date();
  const drivers = await prisma.driver.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      status: true,
      user: { select: { firstName: true, lastName: true } },
      _count: { select: { bookings: { where: { status: "DRIVER_ASSIGNED" } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const map = await loadComplianceMany(prisma, drivers.map((d) => d.id), now);

  console.log(`\n=== Drivers (${drivers.length}) ===`);
  let blocked = 0;
  for (const d of drivers) {
    const c = map.get(d.id)!;
    const name = `${d.user.firstName} ${d.user.lastName ?? ""}`.trim();
    const car = c.vehicle ? c.vehicle.licensePlate : "no car";
    console.log(`\n${c.eligible ? "OK     " : "BLOCKED"}  ${name}  [${car}]  status ${d.status}, ${d._count.bookings} accepted job(s)`);
    if (!c.eligible) {
      blocked++;
      console.log(`         ${blockMessage(c)}`);
    }
    for (const i of c.items) {
      const flags = [
        i.inGrace ? "NO EXPIRY DATE (grace)" : "",
        i.pending ? "renewal waiting" : "",
        i.rejected ? `rejected: ${i.rejected.rejectionReason ?? ""}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      console.log(
        `         ${i.state === "valid" ? " " : "!"} ${DOC_LABELS[i.type].padEnd(24)} ${i.state.padEnd(13)} expires ${fmt(i.expiryDate)}${
          i.daysLeft !== null ? ` (${i.daysLeft}d)` : ""
        }${flags ? `  ${flags}` : ""}`
      );
    }
  }

  console.log(`\n=== Vehicle expiry fields vs approved documents ===`);
  const vehicles = await prisma.vehicle.findMany({
    where: { archivedAt: null },
    select: {
      licensePlate: true,
      motExpiry: true,
      insuranceExpiry: true,
      phvLicenceExpiry: true,
      documents: {
        where: { status: "APPROVED", replacedAt: null, archivedAt: null },
        select: { type: true, expiryDate: true },
      },
    },
  });
  let mismatches = 0;
  for (const v of vehicles) {
    const pairs: [DocType, Date | null][] = [
      ["MOT_CERTIFICATE", v.motExpiry],
      ["VEHICLE_INSURANCE", v.insuranceExpiry],
      ["PHV_LICENCE", v.phvLicenceExpiry],
    ];
    for (const [type, field] of pairs) {
      const doc = v.documents.find((x) => x.type === type);
      const a = field ? fmt(field) : "-";
      const b = doc?.expiryDate ? fmt(doc.expiryDate) : doc ? "no date" : "no approved doc";
      if (a !== b) {
        mismatches++;
        console.log(`  ${v.licensePlate}  ${DOC_LABELS[type].padEnd(20)} Vehicles page ${a}  |  document ${b}`);
      }
    }
  }
  if (!mismatches) console.log("  none");

  const pending = await prisma.driverDocument.count({
    where: { status: "PENDING", replacedAt: null, archivedAt: null },
  });
  console.log(
    `\nSummary: ${blocked} of ${drivers.length} driver(s) would be blocked; ${pending} upload(s) waiting for review; ${mismatches} vehicle date difference(s).`
  );
  console.log(`DOCUMENT_GATING_ENABLED is ${process.env.DOCUMENT_GATING_ENABLED === "true" ? "ON" : "off (shadow)"} in this shell.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
