-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'SCHEDULED_OPEN';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Booking_status_scheduledAt_idx" ON "Booking"("status", "scheduledAt");
