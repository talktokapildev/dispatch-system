/*
  Warnings:

  - You are about to drop the column `address` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `companyName` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `contactEmail` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `invoicingEmail` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `paymentTermsDays` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `dueDate` on the `CorporateInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `periodFrom` on the `CorporateInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `periodTo` on the `CorporateInvoice` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `CorporateAccount` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `billingAddress` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passwordHash` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodEnd` to the `CorporateInvoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodStart` to the `CorporateInvoice` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "CorporateAccount_companyName_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "dispatchedBy" TEXT;

-- AlterTable
ALTER TABLE "CorporateAccount" DROP COLUMN "address",
DROP COLUMN "companyName",
DROP COLUMN "contactEmail",
DROP COLUMN "invoicingEmail",
DROP COLUMN "paymentTermsDays",
ADD COLUMN     "billingAddress" TEXT NOT NULL,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "invoicingDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "passwordHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "CorporateInvoice" DROP COLUMN "dueDate",
DROP COLUMN "periodFrom",
DROP COLUMN "periodTo",
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "periodEnd" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_dispatchedBy_idx" ON "Booking"("dispatchedBy");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateAccount_email_key" ON "CorporateAccount"("email");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_dispatchedBy_fkey" FOREIGN KEY ("dispatchedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
