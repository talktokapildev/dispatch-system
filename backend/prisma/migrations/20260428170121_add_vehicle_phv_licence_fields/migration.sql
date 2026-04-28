-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "phvDiscNumber" TEXT,
ADD COLUMN     "phvLicenceExpiry" TIMESTAMP(3),
ADD COLUMN     "phvLicenceNumber" TEXT;
