-- AlterTable
ALTER TABLE "DriverApplication" ADD COLUMN     "vehicleClass" TEXT,
ADD COLUMN     "vehicleEmissionStandard" TEXT,
ADD COLUMN     "vehicleIsUlezCompliant" BOOLEAN DEFAULT false,
ADD COLUMN     "vehiclePhvDiscNumber" TEXT,
ADD COLUMN     "vehiclePhvLicenceExpiry" TIMESTAMP(3),
ADD COLUMN     "vehiclePhvLicenceNumber" TEXT,
ADD COLUMN     "vehicleSeats" INTEGER;
