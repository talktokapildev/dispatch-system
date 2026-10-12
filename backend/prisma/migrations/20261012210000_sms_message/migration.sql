-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "sid" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "bookingId" TEXT,
    "flightEventId" TEXT,
    "toLast4" TEXT NOT NULL,
    "sender" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "alertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_sid_key" ON "SmsMessage"("sid");

-- CreateIndex
CREATE INDEX "SmsMessage_createdAt_idx" ON "SmsMessage"("createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_bookingId_idx" ON "SmsMessage"("bookingId");
