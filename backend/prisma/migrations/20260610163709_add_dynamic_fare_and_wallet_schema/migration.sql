-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('CREDIT_PROMO', 'DEBIT_TRIP', 'REFUND_CANCEL', 'REFUND_ADMIN', 'EXPIRY');

-- CreateEnum
CREATE TYPE "PromoTarget" AS ENUM ('ALL_PASSENGERS', 'NEW_PASSENGERS_ONLY');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "actualDistance" DOUBLE PRECISION,
ADD COLUMN     "actualDuration" INTEGER,
ADD COLUMN     "cashReceived" DOUBLE PRECISION,
ADD COLUMN     "tipAmount" DOUBLE PRECISION,
ADD COLUMN     "tipPaymentIntentId" TEXT;

-- AlterTable
ALTER TABLE "PricingConfig" ADD COLUMN     "walletBonusExpiryDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "walletMonthlyPromoCap" DOUBLE PRECISION NOT NULL DEFAULT 1000,
ADD COLUMN     "walletWelcomeBonus" DOUBLE PRECISION NOT NULL DEFAULT 25;

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "promoBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "welcomeBonusPending" BOOLEAN NOT NULL DEFAULT true,
    "welcomeBonusIssued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "bookingId" TEXT,
    "promoCampaignId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "targetType" "PromoTarget" NOT NULL,
    "expiryDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totalIssued" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_passengerId_key" ON "WalletAccount"("passengerId");

-- CreateIndex
CREATE INDEX "WalletAccount_passengerId_idx" ON "WalletAccount"("passengerId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");

-- CreateIndex
CREATE INDEX "WalletTransaction_bookingId_idx" ON "WalletTransaction"("bookingId");

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_promoCampaignId_fkey" FOREIGN KEY ("promoCampaignId") REFERENCES "PromoCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
