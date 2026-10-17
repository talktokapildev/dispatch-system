-- Vehicles exist on their own; bookings remember the vehicle that did the trip.

-- Vehicle: driver becomes optional (still at most one current vehicle per driver)
ALTER TABLE "Vehicle" ALTER COLUMN "driverId" DROP NOT NULL;
ALTER TABLE "Vehicle" ADD COLUMN "notes" TEXT;
ALTER TABLE "Vehicle" DROP CONSTRAINT "Vehicle_driverId_fkey";
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Booking: the vehicle used
ALTER TABLE "Booking" ADD COLUMN "vehicleId" TEXT;
CREATE INDEX "Booking_vehicleId_idx" ON "Booking"("vehicleId");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill 1: bookings with a driver get that driver's current vehicle (nobody has changed cars yet)
UPDATE "Booking" b
SET "vehicleId" = v."id"
FROM "Vehicle" v
WHERE b."driverId" IS NOT NULL
  AND v."driverId" = b."driverId"
  AND b."vehicleId" IS NULL;

-- Backfill 2: bookings whose driver was deleted, matched by the PHV licence number stamped on them
UPDATE "Booking" b
SET "vehicleId" = v."id"
FROM "Vehicle" v
WHERE b."vehicleId" IS NULL
  AND b."driverPhvLicenceNumber" IS NOT NULL
  AND v."phvLicenceNumber" = b."driverPhvLicenceNumber";

-- Vehicles archived with their driver become retired: inactive and unassigned
UPDATE "Vehicle" SET "isActive" = false, "driverId" = NULL WHERE "archivedAt" IS NOT NULL;
