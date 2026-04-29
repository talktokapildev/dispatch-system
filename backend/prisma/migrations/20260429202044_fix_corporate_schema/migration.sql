/*
  Warnings:

  - You are about to drop the column `billingAddress` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `invoicingDay` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `passwordHash` on the `CorporateAccount` table. All the data in the column will be lost.
  - You are about to drop the column `issuedAt` on the `CorporateInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `periodEnd` on the `CorporateInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `periodStart` on the `CorporateInvoice` table. All the data in the column will be lost.
  - Added the required column `address` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contactEmail` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `invoicingEmail` to the `CorporateAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dueDate` to the `CorporateInvoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodFrom` to the `CorporateInvoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodTo` to the `CorporateInvoice` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "CorporateAccount_email_key";

-- AlterTable
ALTER TABLE "CorporateAccount" DROP COLUMN "billingAddress",
DROP COLUMN "email",
DROP COLUMN "invoicingDay",
DROP COLUMN "passwordHash",
ADD COLUMN     "address" TEXT NOT NULL,
ADD COLUMN     "contactEmail" TEXT NOT NULL,
ADD COLUMN     "invoicingEmail" TEXT NOT NULL,
ADD COLUMN     "paymentTermsDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "CorporateInvoice" DROP COLUMN "issuedAt",
DROP COLUMN "periodEnd",
DROP COLUMN "periodStart",
ADD COLUMN     "dueDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "periodFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "periodTo" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "CorporateAccount_name_idx" ON "CorporateAccount"("name");
