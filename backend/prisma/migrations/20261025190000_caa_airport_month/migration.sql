-- CreateTable
CREATE TABLE "CaaAirportMonth" (
    "id" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "airport" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "cancelled" INTEGER NOT NULL,
    "onTime" DOUBLE PRECISION NOT NULL,
    "overHour" DOUBLE PRECISION NOT NULL,
    "delaySum" DOUBLE PRECISION NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaaAirportMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaaAirportMonth_period_idx" ON "CaaAirportMonth"("period");

-- CreateIndex
CREATE UNIQUE INDEX "CaaAirportMonth_period_airport_direction_key" ON "CaaAirportMonth"("period", "airport", "direction");
