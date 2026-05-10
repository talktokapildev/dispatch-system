/*
  Warnings:

  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role",
ADD COLUMN     "roles" "UserRole"[];

-- CreateTable
CREATE TABLE "DriverApplication" (
    "id" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "pcoBadgeNumber" TEXT NOT NULL,
    "pcoBadgeExpiry" TIMESTAMP(3) NOT NULL,
    "drivingLicenceNumber" TEXT NOT NULL,
    "vehicleMake" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "vehicleReg" TEXT NOT NULL,
    "vehicleYear" INTEGER NOT NULL,
    "vehicleColour" TEXT NOT NULL,
    "docPcoBadge" TEXT,
    "docDrivingLicFront" TEXT,
    "docDrivingLicBack" TEXT,
    "docPhvLicence" TEXT,
    "docInsurance" TEXT,
    "docMot" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverApplication_phone_idx" ON "DriverApplication"("phone");

-- CreateIndex
CREATE INDEX "DriverApplication_status_idx" ON "DriverApplication"("status");
