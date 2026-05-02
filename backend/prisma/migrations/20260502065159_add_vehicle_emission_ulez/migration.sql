-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "emissionStandard" TEXT,
ADD COLUMN     "isUlezCompliant" BOOLEAN NOT NULL DEFAULT false;
