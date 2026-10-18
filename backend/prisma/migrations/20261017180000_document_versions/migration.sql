-- Driver & vehicle documents: versions, vehicle ownership, expiry reminders.
-- Additive only: code from before this migration keeps working (driverId stays filled).

-- AlterTable
ALTER TABLE "DriverDocument" ALTER COLUMN "driverId" DROP NOT NULL;
ALTER TABLE "DriverDocument" ADD COLUMN "vehicleId" TEXT,
ADD COLUMN "pageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "expiryGraceUntil" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "uploadedBy" TEXT,
ADD COLUMN "replacedAt" TIMESTAMP(3),
ADD COLUMN "replacedById" TEXT,
ADD COLUMN "lastReminderDays" INTEGER,
ADD COLUMN "expiredNotifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "DriverDocument_vehicleId_idx" ON "DriverDocument"("vehicleId");

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ─────────────────────────────────────────────────────────────

-- 1. Vehicle documents belong to the uploading driver's current car (driverId is kept as uploader).
UPDATE "DriverDocument" d
SET "vehicleId" = v."id"
FROM "Vehicle" v
WHERE d."type" IN ('PHV_LICENCE', 'VEHICLE_INSURANCE', 'MOT_CERTIFICATE', 'V5C_LOGBOOK', 'VEHICLE_PHOTO')
  AND d."vehicleId" IS NULL
  AND v."driverId" = d."driverId";

-- 2. Multi-page insurance / V5C were stored one row per page (driver applications).
--    Merge pages uploaded together into the first row; the other rows are archived as merged.
WITH g AS (
  SELECT "id", "fileUrl",
         first_value("id") OVER w AS keeper,
         row_number() OVER w AS rn
  FROM "DriverDocument"
  WHERE "archivedAt" IS NULL
    AND "type" IN ('VEHICLE_INSURANCE', 'V5C_LOGBOOK')
  WINDOW w AS (
    PARTITION BY COALESCE("vehicleId", "driverId"), "type", "status", date_trunc('minute', "createdAt")
    ORDER BY "createdAt", "id"
  )
),
pages AS (
  SELECT keeper, array_agg("fileUrl" ORDER BY rn) AS urls
  FROM g WHERE rn > 1 GROUP BY keeper
)
UPDATE "DriverDocument" d
SET "pageUrls" = pages.urls
FROM pages
WHERE d."id" = pages.keeper;

WITH g AS (
  SELECT "id",
         first_value("id") OVER w AS keeper,
         row_number() OVER w AS rn
  FROM "DriverDocument"
  WHERE "archivedAt" IS NULL
    AND "type" IN ('VEHICLE_INSURANCE', 'V5C_LOGBOOK')
  WINDOW w AS (
    PARTITION BY COALESCE("vehicleId", "driverId"), "type", "status", date_trunc('minute', "createdAt")
    ORDER BY "createdAt", "id"
  )
)
UPDATE "DriverDocument" d
SET "archivedAt" = CURRENT_TIMESTAMP,
    "replacedAt" = CURRENT_TIMESTAMP,
    "replacedById" = g.keeper,
    "notes" = 'Merged into the first page of this document'
FROM g
WHERE d."id" = g."id" AND g.rn > 1;

-- 3. Only one approved version in force per owner and type: older approved ones are marked replaced.
WITH r AS (
  SELECT "id",
         first_value("id") OVER w AS newest,
         row_number() OVER w AS rn
  FROM "DriverDocument"
  WHERE "archivedAt" IS NULL AND "replacedAt" IS NULL AND "status" = 'APPROVED'
  WINDOW w AS (
    PARTITION BY COALESCE("vehicleId", "driverId"), "type"
    ORDER BY COALESCE("reviewedAt", "createdAt") DESC, "createdAt" DESC, "id"
  )
)
UPDATE "DriverDocument" d
SET "replacedAt" = CURRENT_TIMESTAMP, "replacedById" = r.newest
FROM r
WHERE d."id" = r."id" AND r.rn > 1;

-- 4. Placeholder dates (2099) mean "unknown".
UPDATE "DriverDocument" SET "expiryDate" = NULL WHERE "expiryDate" >= '2099-01-01';

-- 5. Missing expiry dates: take them from the driver / vehicle record where we have one.
UPDATE "DriverDocument" d
SET "expiryDate" = dr."pcoLicenseExpiry"
FROM "Driver" dr
WHERE d."type" = 'PCO_LICENSE' AND d."expiryDate" IS NULL
  AND dr."id" = d."driverId" AND dr."pcoLicenseExpiry" < '2099-01-01';

UPDATE "DriverDocument" d
SET "expiryDate" = v."phvLicenceExpiry"
FROM "Vehicle" v
WHERE d."type" = 'PHV_LICENCE' AND d."expiryDate" IS NULL
  AND v."id" = d."vehicleId" AND v."phvLicenceExpiry" < '2099-01-01';

UPDATE "DriverDocument" d
SET "expiryDate" = v."insuranceExpiry"
FROM "Vehicle" v
WHERE d."type" = 'VEHICLE_INSURANCE' AND d."expiryDate" IS NULL
  AND v."id" = d."vehicleId" AND v."insuranceExpiry" < '2099-01-01';

UPDATE "DriverDocument" d
SET "expiryDate" = v."motExpiry"
FROM "Vehicle" v
WHERE d."type" = 'MOT_CERTIFICATE' AND d."expiryDate" IS NULL
  AND v."id" = d."vehicleId" AND v."motExpiry" < '2099-01-01';

-- 6. Approved documents that need an expiry date but still have none: valid for 7 more days
--    while the admin adds the date (or the driver uploads a new copy).
UPDATE "DriverDocument"
SET "expiryGraceUntil" = CURRENT_TIMESTAMP + INTERVAL '7 days'
WHERE "status" = 'APPROVED' AND "archivedAt" IS NULL AND "replacedAt" IS NULL
  AND "expiryDate" IS NULL
  AND "type" IN ('PCO_LICENSE', 'PHV_LICENCE', 'VEHICLE_INSURANCE', 'MOT_CERTIFICATE');

-- 7. Rejection notes were the driver-facing reason.
UPDATE "DriverDocument"
SET "rejectionReason" = "notes"
WHERE "status" = 'REJECTED' AND "notes" IS NOT NULL;
