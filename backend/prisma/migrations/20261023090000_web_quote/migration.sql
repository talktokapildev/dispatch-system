-- CreateTable
CREATE TABLE "WebQuote" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pickupPlaceId" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffPlaceId" TEXT NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "pickupAt" TIMESTAMP(3),
    "passengers" INTEGER NOT NULL,
    "bags" INTEGER NOT NULL,
    "miles" DOUBLE PRECISION,
    "minutes" INTEGER,
    "fareTotal" DOUBLE PRECISION,
    "fromPrice" INTEGER,
    "premiumLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebQuote_ref_key" ON "WebQuote"("ref");

-- CreateIndex
CREATE INDEX "WebQuote_createdAt_idx" ON "WebQuote"("createdAt");
