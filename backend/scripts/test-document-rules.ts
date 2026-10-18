// backend/scripts/test-document-rules.ts
//
// Rule check (pure, no database): which document version is in force, expiry by UK day,
// renewals never take away a valid version, grace period, and the driver-facing message.
//
//   node --env-file=.env -r ts-node/register scripts/test-document-rules.ts
import {
  DocRow,
  REQUIRED_TYPES,
  blockMessage,
  daysUntil,
  evaluateCompliance,
  legacyEligibility,
  parseExpiryDate,
  typeStatus,
} from "../src/services/documentRules";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const now = new Date("2026-10-17T16:00:00Z"); // Sat 17 Oct, 17:00 UK
let n = 0;
const row = (p: Partial<DocRow> & { type: string }): DocRow => ({
  id: `r${++n}`,
  status: "APPROVED",
  expiryDate: null,
  expiryGraceUntil: null,
  replacedAt: null,
  archivedAt: null,
  createdAt: new Date("2026-09-01T10:00:00Z"),
  reviewedAt: new Date("2026-09-01T11:00:00Z"),
  rejectionReason: null,
  ...p,
});
const d = (s: string) => new Date(s + "T00:00:00Z");

// 1. UK days
check("expires today = 0 days, still valid", daysUntil(d("2026-10-17"), now) === 0);
check("valid until 23:59 UK on the expiry day (BST)", daysUntil(d("2026-10-17"), new Date("2026-10-17T22:30:00Z")) === 0 && daysUntil(d("2026-10-17"), new Date("2026-10-17T23:30:00Z")) === -1);
check("app date picker ISO keeps the UK date", parseExpiryDate("2027-05-17T23:00:00.000Z")?.toISOString() === "2027-05-18T00:00:00.000Z");
check("date input parsed", parseExpiryDate("2027-05-18")?.toISOString() === "2027-05-18T00:00:00.000Z");

// 2. Expired yesterday
const ins = typeStatus("VEHICLE_INSURANCE", [row({ type: "VEHICLE_INSURANCE", expiryDate: d("2026-10-16") })], now);
check("expired yesterday → expired", ins.state === "expired", ins.state);

// 3. Renewal waiting while the old one is still valid → still valid
const renewing = typeStatus(
  "VEHICLE_INSURANCE",
  [
    row({ type: "VEHICLE_INSURANCE", expiryDate: d("2026-10-25") }),
    row({ type: "VEHICLE_INSURANCE", status: "PENDING", createdAt: new Date("2026-10-15T09:00:00Z"), reviewedAt: null }),
  ],
  now
);
check("renewal pending, old valid → valid", renewing.state === "valid" && !!renewing.pending, renewing.state);

// 4. Renewal rejected, old still valid → valid, rejection visible
const rej = typeStatus(
  "MOT_CERTIFICATE",
  [
    row({ type: "MOT_CERTIFICATE", expiryDate: d("2026-12-01") }),
    row({ type: "MOT_CERTIFICATE", status: "REJECTED", rejectionReason: "Blurry", createdAt: new Date("2026-10-10T09:00:00Z") }),
  ],
  now
);
check("renewal rejected, old valid → valid + rejected shown", rej.state === "valid" && rej.rejected?.rejectionReason === "Blurry");

// 5. Old expired, renewal pending → expired (with pending)
const expPend = typeStatus(
  "MOT_CERTIFICATE",
  [
    row({ type: "MOT_CERTIFICATE", expiryDate: d("2026-10-01") }),
    row({ type: "MOT_CERTIFICATE", status: "PENDING", createdAt: new Date("2026-10-02T09:00:00Z"), reviewedAt: null }),
  ],
  now
);
check("expired + renewal pending → expired, pending set", expPend.state === "expired" && !!expPend.pending);

// 6. Replaced / archived versions ignored
const replaced = typeStatus(
  "PCO_LICENSE",
  [row({ type: "PCO_LICENSE", expiryDate: d("2027-01-01"), replacedAt: now })],
  now
);
check("replaced version is not in force → missing", replaced.state === "missing");

// 7. Expiry required, none, in grace → valid; grace over → expiry_needed; DBS needs none
const graceOk = typeStatus("PCO_LICENSE", [row({ type: "PCO_LICENSE", expiryGraceUntil: new Date(now.getTime() + 86_400_000) })], now);
const graceOver = typeStatus("PCO_LICENSE", [row({ type: "PCO_LICENSE", expiryGraceUntil: new Date(now.getTime() - 1000) })], now);
const dbs = typeStatus("DBS_CHECK", [row({ type: "DBS_CHECK" })], now);
check("no expiry, in grace → valid", graceOk.state === "valid" && graceOk.inGrace);
check("no expiry, grace over → expiry_needed", graceOver.state === "expiry_needed");
check("DBS without expiry → valid", dbs.state === "valid");

// 8. Rejected first upload, nothing approved → rejected
const firstRej = typeStatus("V5C_LOGBOOK", [row({ type: "V5C_LOGBOOK", status: "REJECTED", rejectionReason: "Wrong car" })], now);
check("first upload rejected → rejected", firstRej.state === "rejected");

// 9. Whole driver
const full = (over: Partial<Record<string, Partial<DocRow>>> = {}) =>
  REQUIRED_TYPES.map((type) =>
    row({
      type,
      expiryDate: ["PCO_LICENSE", "PHV_LICENCE", "VEHICLE_INSURANCE", "MOT_CERTIFICATE"].includes(type) ? d("2027-06-01") : null,
      ...(over[type] ?? {}),
    })
  );
const split = (rows: DocRow[]) => ({
  driverDocs: rows.filter((r) => ["PCO_LICENSE", "DRIVING_LICENSE", "DRIVING_LICENSE_BACK", "DBS_CHECK"].includes(r.type)),
  vehicleDocs: rows.filter((r) => !["PCO_LICENSE", "DRIVING_LICENSE", "DRIVING_LICENSE_BACK", "DBS_CHECK"].includes(r.type)),
});
const car = { id: "v1", licensePlate: "GL72 LXW" };

const ok = evaluateCompliance({ ...split(full()), vehicle: car, now });
check("all documents in order → eligible", ok.eligible && ok.problems.length === 0);

const noCar = evaluateCompliance({ ...split(full()), vehicle: null, now });
check("no vehicle → not eligible", !noCar.eligible && noCar.noVehicle);
check("no vehicle → legacy missingDocs lists car documents", legacyEligibility(noCar).missingDocs.includes("VEHICLE_INSURANCE"));

const expired = evaluateCompliance({
  ...split(full({ VEHICLE_INSURANCE: { expiryDate: d("2026-05-18") } })),
  vehicle: car,
  now,
});
const msg = blockMessage(expired);
check("expired insurance → not eligible", !expired.eligible && expired.problems[0]?.type === "VEHICLE_INSURANCE");
check("message names car and date", msg.includes("GL72 LXW") && msg.includes("18 May 2026"), msg);
check("legacy expiredDocs", legacyEligibility(expired).expiredDocs.join() === "VEHICLE_INSURANCE");

const soon = evaluateCompliance({ ...split(full({ MOT_CERTIFICATE: { expiryDate: d("2026-11-01") } })), vehicle: car, now });
check("MOT in 15 days → eligible, expiring soon", soon.eligible && soon.expiringSoon[0]?.type === "MOT_CERTIFICATE");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
