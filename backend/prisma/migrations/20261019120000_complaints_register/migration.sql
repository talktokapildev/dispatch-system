-- TfL Condition 7: complaints / compliments register (template "COMPLAINT/COMPLIMENT").
-- New tables, then the complaints that lived in Booking.feedback ("[COMPLAINT] Category: …")
-- with their "[ACK] Resolved by <userId> at <iso> | Note: …" line in Booking.operatorNotes are
-- moved here, and that text is removed from the booking (rating comments and other operator
-- notes are kept). IDs use md5(...)::uuid, not gen_random_uuid() (local Postgres is older than 13).

-- CreateEnum
CREATE TYPE "ComplaintType" AS ENUM ('COMPLAINT', 'COMPLIMENT');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('RECEIVED', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ComplaintOutcome" AS ENUM ('UPHELD', 'PARTLY_UPHELD', 'NOT_UPHELD', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ComplaintChannel" AS ENUM ('APP', 'PHONE', 'EMAIL', 'IN_PERSON');

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "type" "ComplaintType" NOT NULL DEFAULT 'COMPLAINT',
    "status" "ComplaintStatus" NOT NULL DEFAULT 'RECEIVED',
    "channel" "ComplaintChannel" NOT NULL DEFAULT 'APP',
    "category" TEXT,
    "details" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT,
    "passengerId" TEXT,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "bookingDateTime" TIMESTAMP(3),
    "complainantName" TEXT,
    "complainantAddress" TEXT,
    "complainantPhone" TEXT,
    "driverName" TEXT,
    "vehicleReg" TEXT,
    "handledByUserId" TEXT,
    "handledByName" TEXT,
    "outcome" "ComplaintOutcome",
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "representativeName" TEXT,
    "closedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintContact" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffName" TEXT NOT NULL,
    "staffUserId" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_refNo_key" ON "Complaint"("refNo");

-- CreateIndex
CREATE INDEX "Complaint_bookingId_idx" ON "Complaint"("bookingId");

-- CreateIndex
CREATE INDEX "Complaint_passengerId_idx" ON "Complaint"("passengerId");

-- CreateIndex
CREATE INDEX "Complaint_driverId_idx" ON "Complaint"("driverId");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "ComplaintContact_complaintId_idx" ON "ComplaintContact"("complaintId");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintContact" ADD CONSTRAINT "ComplaintContact_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Move the complaints out of Booking.feedback ─────────────────────────────

CREATE TEMP TABLE "_old_complaint" AS
SELECT
  md5(random()::text || clock_timestamp()::text || b."id")::uuid::text AS "id",
  b."id" AS "bookingId",
  b."passengerId",
  b."driverId",
  b."vehicleId",
  b."updatedAt" AS "receivedAt",
  COALESCE(b."scheduledAt", b."tripStartedAt", b."completedAt", b."createdAt") AS "bookingDateTime",
  NULLIF(trim(regexp_replace(split_part(b."feedback", E'\n', 1), '^\[COMPLAINT\]\s*(Category:\s*)?', '')), '') AS "category",
  CASE WHEN strpos(b."feedback", E'\n') > 0
       THEN NULLIF(trim(substr(b."feedback", strpos(b."feedback", E'\n') + 1)), '')
  END AS "details",
  regexp_match(COALESCE(b."operatorNotes", ''), '\[ACK\] Resolved by (\S+) at (\S+) \| Note: ([^\n]*)') AS "ack"
FROM "Booking" b
WHERE b."feedback" LIKE '[COMPLAINT]%';

INSERT INTO "Complaint" (
  "id", "refNo", "type", "status", "channel", "category", "details", "receivedAt",
  "bookingId", "passengerId", "driverId", "vehicleId", "bookingDateTime",
  "complainantName", "complainantPhone", "driverName", "vehicleReg",
  "handledByUserId", "handledByName", "resolutionNote", "resolvedAt", "representativeName", "closedByUserId",
  "createdAt", "updatedAt"
)
SELECT
  o."id",
  'CC-' || y || '-' || lpad(row_number() OVER (PARTITION BY y ORDER BY o."receivedAt", o."id")::text, 3, '0'),
  'COMPLAINT', CASE WHEN o."ack" IS NULL THEN 'RECEIVED' ELSE 'RESOLVED' END::"ComplaintStatus", 'APP',
  o."category", COALESCE(o."details", '(No description provided)'), o."receivedAt",
  o."bookingId", o."passengerId", o."driverId", o."vehicleId", o."bookingDateTime",
  NULLIF(trim(pu."firstName" || ' ' || COALESCE(pu."lastName", '')), ''), pu."phone",
  NULLIF(trim(du."firstName" || ' ' || COALESCE(du."lastName", '')), ''), v."licensePlate",
  o."ack"[1],
  CASE WHEN o."ack" IS NOT NULL THEN COALESCE(NULLIF(trim(ru."firstName" || ' ' || COALESCE(ru."lastName", '')), ''), 'Staff') END,
  NULLIF(trim(o."ack"[3]), ''),
  CASE WHEN o."ack" IS NOT NULL THEN (o."ack"[2])::timestamptz AT TIME ZONE 'UTC' END,
  CASE WHEN o."ack" IS NOT NULL THEN COALESCE(NULLIF(trim(ru."firstName" || ' ' || COALESCE(ru."lastName", '')), ''), 'Staff') END,
  o."ack"[1],
  o."receivedAt", CURRENT_TIMESTAMP
FROM (
  SELECT *, extract(year FROM (("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London'))::int::text AS y
  FROM "_old_complaint"
) o
LEFT JOIN "Passenger" p ON p."id" = o."passengerId"
LEFT JOIN "User" pu ON pu."id" = p."userId"
LEFT JOIN "Driver" d ON d."id" = o."driverId"
LEFT JOIN "User" du ON du."id" = d."userId"
LEFT JOIN "Vehicle" v ON v."id" = o."vehicleId"
LEFT JOIN "User" ru ON ru."id" = o."ack"[1];

-- The old resolution becomes the first history entry
INSERT INTO "ComplaintContact" ("id", "complaintId", "at", "staffName", "staffUserId", "note")
SELECT md5(random()::text || clock_timestamp()::text || c."id")::uuid::text,
       c."id", c."resolvedAt", c."representativeName", c."closedByUserId",
       'Resolved (before the register was kept): ' || COALESCE(c."resolutionNote", '')
FROM "Complaint" c
WHERE c."status" = 'RESOLVED';

-- Take the complaint text and the [ACK] lines off the bookings
UPDATE "Booking" b
SET "feedback" = NULL,
    "operatorNotes" = NULLIF(trim(both E'\n ' FROM regexp_replace(COALESCE(b."operatorNotes", ''), '(^|\n)\[ACK\][^\n]*', '', 'g')), '')
FROM "_old_complaint" o
WHERE o."bookingId" = b."id";

DROP TABLE "_old_complaint";
