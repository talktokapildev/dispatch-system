-- TfL driver register: DriverRegister (personal details, 1:1 with Driver, kept off the Driver
-- table so they never appear in booking/driver responses) + DriverEngagement (date first
-- available / leaving, restart / finish history).
-- Additive only. Backfill: one engagement per existing driver (start = UK day the driver was
-- created; archived drivers end on the UK day they were archived).

-- CreateTable
CREATE TABLE "DriverRegister" (
    "driverId" TEXT NOT NULL,
    "middleNames" TEXT,
    "callSign" TEXT,
    "address" TEXT,
    "postcode" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "niNumber" TEXT,
    "licenceCheckedAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverRegister_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "DriverEngagement" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "dismissedForConduct" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "startedBy" TEXT,
    "endedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverRegister_callSign_key" ON "DriverRegister"("callSign");

-- CreateIndex
CREATE INDEX "DriverEngagement_driverId_idx" ON "DriverEngagement"("driverId");

-- AddForeignKey
ALTER TABLE "DriverRegister" ADD CONSTRAINT "DriverRegister_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEngagement" ADD CONSTRAINT "DriverEngagement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ─────────────────────────────────────────────────────────────
INSERT INTO "DriverEngagement" ("id", "driverId", "startedAt", "endedAt", "endReason", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text || d."id")::uuid::text,
  d."id",
  (((d."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date)::timestamp,
  CASE WHEN d."archivedAt" IS NOT NULL
       THEN (((d."archivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date)::timestamp END,
  CASE WHEN d."archivedAt" IS NOT NULL THEN 'Archived before the driver register' END,
  CURRENT_TIMESTAMP
FROM "Driver" d
WHERE NOT EXISTS (SELECT 1 FROM "DriverEngagement" e WHERE e."driverId" = d."id");
