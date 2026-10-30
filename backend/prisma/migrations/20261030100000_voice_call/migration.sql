-- Calls answered by Araa, the AI phone receptionist
CREATE TABLE "VoiceCall" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "fromNumber" TEXT,
    "passengerId" TEXT,
    "bookingId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "callerName" TEXT,
    "message" TEXT,
    "quote" JSONB,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "voice" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,

    CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceCall_callId_key" ON "VoiceCall"("callId");
CREATE UNIQUE INDEX "VoiceCall_bookingId_key" ON "VoiceCall"("bookingId");
CREATE INDEX "VoiceCall_startedAt_idx" ON "VoiceCall"("startedAt");
CREATE INDEX "VoiceCall_passengerId_idx" ON "VoiceCall"("passengerId");

ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoiceCall" ADD CONSTRAINT "VoiceCall_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
