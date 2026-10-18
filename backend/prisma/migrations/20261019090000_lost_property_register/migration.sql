-- TfL Condition 9: lost property register (template "LOST/FOUND PROPERTY").
-- Extends the existing "LostProperty" table (additive: nothing is dropped), adds the enquiry
-- history table, and backfills the existing reports: ref numbers, vehicle reg, booking
-- date/time, customer name, and each old note as the first history entry.
-- IDs use md5(...)::uuid, not gen_random_uuid() (local Postgres is older than 13).

-- CreateEnum
CREATE TYPE "LostPropertySource" AS ENUM ('PASSENGER_REPORT', 'ADMIN_FOUND');

-- CreateEnum
CREATE TYPE "LostPropertyOutcome" AS ENUM ('COLLECTED_BY_OWNER', 'POSTED_TO_OWNER', 'RETURNED_BY_DRIVER', 'HANDED_TO_POLICE', 'DISPOSED', 'DONATED');

-- DropForeignKey
ALTER TABLE "LostProperty" DROP CONSTRAINT "LostProperty_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "LostProperty" DROP CONSTRAINT "LostProperty_passengerId_fkey";

-- AlterTable
ALTER TABLE "LostProperty" ADD COLUMN     "bookingDateTime" TIMESTAMP(3),
ADD COLUMN     "closedByUserId" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "customerAddress" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "handedInByDriverId" TEXT,
ADD COLUMN     "handedInByName" TEXT,
ADD COLUMN     "outcome" "LostPropertyOutcome",
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "outcomeDetails" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "refNo" TEXT,
ADD COLUMN     "representativeName" TEXT,
ADD COLUMN     "source" "LostPropertySource" NOT NULL DEFAULT 'PASSENGER_REPORT',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "vehicleId" TEXT,
ADD COLUMN     "vehicleReg" TEXT,
ALTER COLUMN "bookingId" DROP NOT NULL,
ALTER COLUMN "passengerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "LostPropertyContact" (
    "id" TEXT NOT NULL,
    "lostPropertyId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffName" TEXT NOT NULL,
    "staffUserId" TEXT,
    "note" TEXT NOT NULL,
    "shownToPassenger" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostPropertyContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LostPropertyContact_lostPropertyId_idx" ON "LostPropertyContact"("lostPropertyId");

-- AddForeignKey
ALTER TABLE "LostProperty" ADD CONSTRAINT "LostProperty_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostProperty" ADD CONSTRAINT "LostProperty_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostProperty" ADD CONSTRAINT "LostProperty_handedInByDriverId_fkey" FOREIGN KEY ("handedInByDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostProperty" ADD CONSTRAINT "LostProperty_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostPropertyContact" ADD CONSTRAINT "LostPropertyContact_lostPropertyId_fkey" FOREIGN KEY ("lostPropertyId") REFERENCES "LostProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill existing reports ───────────────────────────────────────────────

-- Ref numbers LP-<UK year>-NNN in the order the reports were made
UPDATE "LostProperty" lp
SET "refNo" = n.ref
FROM (
  SELECT "id",
         'LP-' || y || '-' || lpad(row_number() OVER (PARTITION BY y ORDER BY "reportedAt", "id")::text, 3, '0') AS ref
  FROM (
    SELECT "id", "reportedAt",
           extract(year FROM (("reportedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London'))::int::text AS y
    FROM "LostProperty"
  ) t
) n
WHERE lp."id" = n."id";

-- Vehicle (the car that did the trip), booking date/time, customer name — copied from the booking
UPDATE "LostProperty" lp
SET "vehicleId"       = b."vehicleId",
    "vehicleReg"      = v."licensePlate",
    "bookingDateTime" = COALESCE(b."scheduledAt", b."tripStartedAt", b."completedAt", b."createdAt")
FROM "Booking" b
LEFT JOIN "Vehicle" v ON v."id" = b."vehicleId"
WHERE b."id" = lp."bookingId";

UPDATE "LostProperty" lp
SET "customerName" = trim(u."firstName" || ' ' || COALESCE(u."lastName", ''))
FROM "Passenger" p
JOIN "User" u ON u."id" = p."userId"
WHERE p."id" = lp."passengerId";

-- Each old note (it was shown to the passenger) becomes the first enquiry entry
INSERT INTO "LostPropertyContact" ("id", "lostPropertyId", "at", "staffName", "note", "shownToPassenger")
SELECT md5(random()::text || clock_timestamp()::text || lp."id")::uuid::text,
       lp."id",
       COALESCE(lp."resolvedAt", lp."reportedAt"),
       'Before history was recorded',
       lp."adminNotes",
       true
FROM "LostProperty" lp
WHERE lp."adminNotes" IS NOT NULL AND trim(lp."adminNotes") <> '';

-- Every row has a ref now
ALTER TABLE "LostProperty" ALTER COLUMN "refNo" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "LostProperty_refNo_key" ON "LostProperty"("refNo");
