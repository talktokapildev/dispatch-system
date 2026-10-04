-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "flightSnapshot" JSONB,
ADD COLUMN     "flightSnapshotFetchedAt" TIMESTAMP(3),
ADD COLUMN     "luggageType" TEXT,
ADD COLUMN     "meetingPointId" TEXT;

-- AlterTable
ALTER TABLE "SurchargeZone" ADD COLUMN     "airportIata" TEXT;

-- CreateTable
CREATE TABLE "AirportMeetingPoint" (
    "id" TEXT NOT NULL,
    "airportIata" TEXT NOT NULL,
    "terminal" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportMeetingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AirportMeetingPoint_airportIata_terminal_key" ON "AirportMeetingPoint"("airportIata", "terminal");

-- CreateIndex
CREATE INDEX "Booking_flightSnapshotFetchedAt_idx" ON "Booking"("flightSnapshotFetchedAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_meetingPointId_fkey" FOREIGN KEY ("meetingPointId") REFERENCES "AirportMeetingPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
