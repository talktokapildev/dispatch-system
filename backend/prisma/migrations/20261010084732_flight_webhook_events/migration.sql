-- CreateTable
CREATE TABLE "FlightWebhookEvent" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" TEXT,
    "flightNumber" TEXT,
    "flightCount" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER,
    "payload" JSONB NOT NULL,

    CONSTRAINT "FlightWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlightWebhookEvent_receivedAt_idx" ON "FlightWebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "FlightWebhookEvent_subscriptionId_idx" ON "FlightWebhookEvent"("subscriptionId");
