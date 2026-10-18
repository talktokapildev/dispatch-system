-- Vehicle history for the TfL vehicle record:
--   VehicleAssignment     which driver had which car, and when
--   VehicleServicePeriod  "Start Date / Vehicle Ceased" (a car can leave the fleet and come back)
-- Both are written only by the trigger "vehicle_history" on "Vehicle", so every code path that
-- changes a car's driver, retires or restores it is recorded.
-- Ids are md5-based uuids (gen_random_uuid() needs Postgres 13+). Times use clock_timestamp()
-- so two changes in one transaction keep their order.

-- CreateTable
CREATE TABLE "VehicleAssignment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT,
    "driverName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleServicePeriod" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleServicePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleAssignment_vehicleId_idx" ON "VehicleAssignment"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleAssignment_driverId_idx" ON "VehicleAssignment"("driverId");

-- CreateIndex
CREATE INDEX "VehicleServicePeriod_vehicleId_idx" ON "VehicleServicePeriod"("vehicleId");

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleServicePeriod" ADD CONSTRAINT "VehicleServicePeriod_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Trigger ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vehicle_history_new_id(seed TEXT) RETURNS TEXT AS $$
  SELECT md5(random()::text || clock_timestamp()::text || seed)::uuid::text;
$$ LANGUAGE sql VOLATILE;

CREATE OR REPLACE FUNCTION vehicle_history_driver_name(d_id TEXT) RETURNS TEXT AS $$
  SELECT COALESCE(NULLIF(trim(concat_ws(' ', u."firstName", u."lastName")), ''), 'Unknown driver')
  FROM "Driver" d JOIN "User" u ON u."id" = d."userId"
  WHERE d."id" = d_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION vehicle_history() RETURNS trigger AS $$
DECLARE
  t TIMESTAMP(3) := (clock_timestamp() AT TIME ZONE 'UTC');
  reason TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "VehicleServicePeriod" ("id", "vehicleId", "startedAt", "endedAt")
    VALUES (vehicle_history_new_id(NEW."id"), NEW."id", NEW."startDate", NEW."archivedAt");
    IF NEW."driverId" IS NOT NULL THEN
      INSERT INTO "VehicleAssignment" ("id", "vehicleId", "driverId", "driverName", "startedAt")
      VALUES (vehicle_history_new_id(NEW."id"), NEW."id", NEW."driverId",
              COALESCE(vehicle_history_driver_name(NEW."driverId"), 'Unknown driver'), t);
    END IF;
    RETURN NEW;
  END IF;

  -- Driver changed
  IF NEW."driverId" IS DISTINCT FROM OLD."driverId" THEN
    IF OLD."driverId" IS NOT NULL THEN
      IF OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL THEN
        reason := 'Vehicle retired';
      ELSIF EXISTS (SELECT 1 FROM "Driver" WHERE "id" = OLD."driverId" AND "archivedAt" IS NOT NULL) THEN
        reason := 'Driver left';
      ELSIF NEW."driverId" IS NULL THEN
        reason := 'Unassigned';
      ELSE
        reason := 'Reassigned';
      END IF;
      UPDATE "VehicleAssignment" SET "endedAt" = t, "endReason" = reason
      WHERE "vehicleId" = NEW."id" AND "endedAt" IS NULL;
    END IF;
    IF NEW."driverId" IS NOT NULL THEN
      INSERT INTO "VehicleAssignment" ("id", "vehicleId", "driverId", "driverName", "startedAt")
      VALUES (vehicle_history_new_id(NEW."id"), NEW."id", NEW."driverId",
              COALESCE(vehicle_history_driver_name(NEW."driverId"), 'Unknown driver'), t);
    END IF;
  END IF;

  -- Retired / restored
  IF OLD."archivedAt" IS NULL AND NEW."archivedAt" IS NOT NULL THEN
    UPDATE "VehicleServicePeriod" SET "endedAt" = NEW."archivedAt"
    WHERE "vehicleId" = NEW."id" AND "endedAt" IS NULL;
  ELSIF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NULL THEN
    INSERT INTO "VehicleServicePeriod" ("id", "vehicleId", "startedAt")
    VALUES (vehicle_history_new_id(NEW."id"), NEW."id", t);
  END IF;

  -- "Start date" edited on the Vehicles page: it is the start of the first period
  IF NEW."startDate" IS DISTINCT FROM OLD."startDate" THEN
    UPDATE "VehicleServicePeriod" SET "startedAt" = NEW."startDate"
    WHERE "id" = (SELECT "id" FROM "VehicleServicePeriod" WHERE "vehicleId" = NEW."id"
                  ORDER BY "startedAt", "createdAt" LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_history ON "Vehicle";
CREATE TRIGGER vehicle_history
  AFTER INSERT OR UPDATE OF "driverId", "archivedAt", "startDate" ON "Vehicle"
  FOR EACH ROW EXECUTE PROCEDURE vehicle_history();

-- ── Backfill ─────────────────────────────────────────────────────────────

-- One service period per car: start date → ceased (retired) date
INSERT INTO "VehicleServicePeriod" ("id", "vehicleId", "startedAt", "endedAt")
SELECT vehicle_history_new_id(v."id"), v."id", v."startDate", v."archivedAt"
FROM "Vehicle" v
WHERE NOT EXISTS (SELECT 1 FROM "VehicleServicePeriod" p WHERE p."vehicleId" = v."id");

-- Current assignments: from the later of the car's start date and the driver's first available date
INSERT INTO "VehicleAssignment" ("id", "vehicleId", "driverId", "driverName", "startedAt", "note")
SELECT vehicle_history_new_id(v."id"), v."id", v."driverId",
       COALESCE(vehicle_history_driver_name(v."driverId"), 'Unknown driver'),
       GREATEST(v."startDate", COALESCE((SELECT min(e."startedAt") FROM "DriverEngagement" e WHERE e."driverId" = v."driverId"), v."startDate")),
       'Before history was recorded'
FROM "Vehicle" v
WHERE v."driverId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "VehicleAssignment" a WHERE a."vehicleId" = v."id");
