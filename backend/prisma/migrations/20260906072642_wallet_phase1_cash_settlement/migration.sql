-- AlterEnum
ALTER TYPE "WalletTxType" ADD VALUE 'CASH_ADJUSTMENT';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "actualCashCollected" DOUBLE PRECISION,
ADD COLUMN     "suggestedCashCollection" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "remainingAmount" DOUBLE PRECISION;
