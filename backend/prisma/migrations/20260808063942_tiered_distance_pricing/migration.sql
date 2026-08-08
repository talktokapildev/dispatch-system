/*
  Warnings:

  - You are about to drop the column `perMile` on the `PricingConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PricingConfig" DROP COLUMN "perMile",
ADD COLUMN     "perMileAfterTier" DOUBLE PRECISION NOT NULL DEFAULT 1.80,
ADD COLUMN     "perMileFirstTier" DOUBLE PRECISION NOT NULL DEFAULT 2.00,
ADD COLUMN     "tierThresholdMiles" DOUBLE PRECISION NOT NULL DEFAULT 20,
ALTER COLUMN "baseFare" SET DEFAULT 2.00,
ALTER COLUMN "minimumFare" SET DEFAULT 10.00;
