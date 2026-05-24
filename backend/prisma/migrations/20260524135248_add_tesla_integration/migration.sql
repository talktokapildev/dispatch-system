-- CreateTable
CREATE TABLE "TeslaIntegration" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vehicleName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeslaIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeslaIntegration_driverId_key" ON "TeslaIntegration"("driverId");

-- AddForeignKey
ALTER TABLE "TeslaIntegration" ADD CONSTRAINT "TeslaIntegration_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
