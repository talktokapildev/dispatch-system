-- Record completed trip (admin) + receipts. Additive only: new nullable/defaulted columns.

-- Booking: how/when it was booked, and whether it was recorded after the trip
ALTER TABLE "Booking" ADD COLUMN "bookedVia" TEXT;
ALTER TABLE "Booking" ADD COLUMN "bookedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "recordedAfterTrip" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "recordedBy" TEXT;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_recordedBy_fkey"
  FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Booking_recordedBy_idx" ON "Booking"("recordedBy");

-- Receipt: snapshot fields for admin-generated receipts
ALTER TABLE "Receipt" ADD COLUMN "passengerName" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "billTo" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "operatorAddress" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "pickupAt" TIMESTAMP(3);
ALTER TABLE "Receipt" ADD COLUMN "dropoffAt" TIMESTAMP(3);
ALTER TABLE "Receipt" ADD COLUMN "updatedAt" TIMESTAMP(3);
