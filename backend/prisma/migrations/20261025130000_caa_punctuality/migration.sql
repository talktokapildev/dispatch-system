-- CreateTable
CREATE TABLE "CaaPunctuality" (
    "id" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "airport" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "charter" TEXT NOT NULL,
    "matched" INTEGER NOT NULL,
    "unmatched" INTEGER NOT NULL,
    "cancelled" INTEGER NOT NULL,
    "early15Pct" DOUBLE PRECISION NOT NULL,
    "early1Pct" DOUBLE PRECISION NOT NULL,
    "late15Pct" DOUBLE PRECISION NOT NULL,
    "late30Pct" DOUBLE PRECISION NOT NULL,
    "late60Pct" DOUBLE PRECISION NOT NULL,
    "late120Pct" DOUBLE PRECISION NOT NULL,
    "late180Pct" DOUBLE PRECISION NOT NULL,
    "late360Pct" DOUBLE PRECISION NOT NULL,
    "lateMorePct" DOUBLE PRECISION NOT NULL,
    "unmatchedPct" DOUBLE PRECISION NOT NULL,
    "cancelledPct" DOUBLE PRECISION NOT NULL,
    "avgDelayMin" DOUBLE PRECISION NOT NULL,
    "runDate" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaaPunctuality_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaaPunctuality_period_idx" ON "CaaPunctuality"("period");

-- CreateIndex
CREATE UNIQUE INDEX "CaaPunctuality_period_direction_airport_airline_charter_key" ON "CaaPunctuality"("period", "direction", "airport", "airline", "charter");
