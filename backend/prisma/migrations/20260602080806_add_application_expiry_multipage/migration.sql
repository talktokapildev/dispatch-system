/*
  Warnings:

  - The `docInsurance` column on the `DriverApplication` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `docV5c` column on the `DriverApplication` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "DriverApplication" ADD COLUMN     "docDbsExpiry" TIMESTAMP(3),
ADD COLUMN     "docInsuranceExpiry" TIMESTAMP(3),
ADD COLUMN     "docMotExpiry" TIMESTAMP(3),
ADD COLUMN     "docPhvExpiry" TIMESTAMP(3),
DROP COLUMN "docInsurance",
ADD COLUMN     "docInsurance" TEXT[],
DROP COLUMN "docV5c",
ADD COLUMN     "docV5c" TEXT[];
