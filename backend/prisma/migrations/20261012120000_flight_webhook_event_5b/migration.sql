-- AlterTable
ALTER TABLE "FlightWebhookEvent" ADD COLUMN     "notificationId" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FlightWebhookEvent_notificationId_idx" ON "FlightWebhookEvent"("notificationId");
