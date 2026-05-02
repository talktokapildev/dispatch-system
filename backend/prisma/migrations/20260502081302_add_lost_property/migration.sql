-- CreateEnum
CREATE TYPE "LostPropertyStatus" AS ENUM ('REPORTED', 'FOUND', 'RETURNED', 'CLOSED');

-- CreateTable
CREATE TABLE "LostProperty" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "LostPropertyStatus" NOT NULL DEFAULT 'REPORTED',
    "adminNotes" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LostProperty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LostProperty_bookingId_idx" ON "LostProperty"("bookingId");

-- CreateIndex
CREATE INDEX "LostProperty_passengerId_idx" ON "LostProperty"("passengerId");

-- CreateIndex
CREATE INDEX "LostProperty_status_idx" ON "LostProperty"("status");

-- AddForeignKey
ALTER TABLE "LostProperty" ADD CONSTRAINT "LostProperty_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostProperty" ADD CONSTRAINT "LostProperty_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
