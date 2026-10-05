-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bookedPickupAt" TIMESTAMP(3),
ADD COLUMN     "flightWatchId" TEXT,
ADD COLUMN     "pickupOffsetMinutes" INTEGER;

-- CreateTable
CREATE TABLE "FlightWatch" (
    "id" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "arrivalDate" TEXT NOT NULL,
    "airportIata" TEXT NOT NULL DEFAULT 'LGW',
    "subscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WATCHING',
    "expectedGateArrivalAt" TIMESTAMP(3),
    "actualGateArrivalAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "unverified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "FlightWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingFlightEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "oldPickupAt" TIMESTAMP(3),
    "newPickupAt" TIMESTAMP(3),
    "note" TEXT,
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingFlightEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlightWatch_status_idx" ON "FlightWatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FlightWatch_flightNumber_arrivalDate_airportIata_key" ON "FlightWatch"("flightNumber", "arrivalDate", "airportIata");

-- CreateIndex
CREATE INDEX "BookingFlightEvent_bookingId_type_idx" ON "BookingFlightEvent"("bookingId", "type");

-- CreateIndex
CREATE INDEX "Booking_flightWatchId_idx" ON "Booking"("flightWatchId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_flightWatchId_fkey" FOREIGN KEY ("flightWatchId") REFERENCES "FlightWatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingFlightEvent" ADD CONSTRAINT "BookingFlightEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
