import { PrismaClient } from "@prisma/client";

// ─── WalletService ────────────────────────────────────────────────────────────
// Handles all wallet operations: credit, debit, refund, expiry.
// Completely standalone — no imports from other services.
// Every method is wrapped in try/catch at call sites to ensure
// wallet failures never break existing booking/payment flows.

export class WalletService {
  constructor(private prisma: PrismaClient) {}

  // ─── Get or create wallet for a passenger ──────────────────────────────────
  async getOrCreateWallet(passengerId: string) {
    const existing = await this.prisma.walletAccount.findUnique({
      where: { passengerId },
    });
    if (existing) return existing;

    return this.prisma.walletAccount.create({
      data: { passengerId },
    });
  }

  // ─── Get wallet balance ─────────────────────────────────────────────────────
  async getBalance(passengerId: string) {
    const wallet = await this.getOrCreateWallet(passengerId);
    return {
      promoBalance: wallet.promoBalance,
      realBalance: wallet.realBalance,
      totalBalance: wallet.promoBalance + wallet.realBalance,
      welcomeBonusPending: wallet.welcomeBonusPending,
      welcomeBonusIssued: wallet.welcomeBonusIssued,
    };
  }

  // ─── Process welcome bonus after first completed trip ──────────────────────
  // Called from dispatch.service.ts on COMPLETED — wrapped in try/catch there.
  async processWelcomeBonus(passengerId: string): Promise<void> {
    const wallet = await this.getOrCreateWallet(passengerId);

    // Already issued or not pending — nothing to do
    if (!wallet.welcomeBonusPending || wallet.welcomeBonusIssued) return;

    // Get config from pricing settings
    const config = await this.getWalletConfig();

    // Check monthly cap
    const capRemaining = await this.getMonthlyCapRemaining(
      config.monthlyPromoCap
    );
    if (capRemaining < config.welcomeBonus) {
      // Cap hit — mark bonus as no longer pending but don't issue
      await this.prisma.walletAccount.update({
        where: { passengerId },
        data: { welcomeBonusPending: false },
      });
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.bonusExpiryDays);

    // Credit wallet and record transaction atomically
    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: {
          promoBalance: { increment: config.welcomeBonus },
          welcomeBonusPending: false,
          welcomeBonusIssued: true,
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CREDIT_PROMO",
          amount: config.welcomeBonus,
          balanceAfter: wallet.promoBalance + config.welcomeBonus,
          expiresAt,
          note: "Welcome bonus",
        },
      }),
    ]);
  }

  // ─── Debit wallet for a trip ────────────────────────────────────────────────
  async debitTrip(
    passengerId: string,
    amount: number,
    bookingId: string
  ): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(passengerId);

    // Check sufficient promo balance (promo-only for now)
    if (wallet.promoBalance < amount) return false;

    const balanceAfter = wallet.promoBalance - amount;

    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: { decrement: amount } },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "DEBIT_TRIP",
          amount,
          balanceAfter,
          bookingId,
          note: `Trip payment`,
        },
      }),
    ]);

    return true;
  }

  // ─── Refund wallet on cancellation ─────────────────────────────────────────
  async refundCancel(
    passengerId: string,
    amount: number,
    bookingId: string
  ): Promise<void> {
    const wallet = await this.getOrCreateWallet(passengerId);

    // Find original debit to inherit expiry date
    const originalDebit = await this.prisma.walletTransaction.findFirst({
      where: { walletId: wallet.id, bookingId, type: "DEBIT_TRIP" },
      orderBy: { createdAt: "desc" },
    });

    // Find the original credit expiry to preserve it
    const originalCredit = await this.prisma.walletTransaction.findFirst({
      where: { walletId: wallet.id, type: "CREDIT_PROMO" },
      orderBy: { createdAt: "desc" },
    });

    const balanceAfter = wallet.promoBalance + amount;

    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: { increment: amount } },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "REFUND_CANCEL",
          amount,
          balanceAfter,
          bookingId,
          expiresAt: originalCredit?.expiresAt ?? undefined,
          note: "Cancellation refund",
        },
      }),
    ]);
  }

  // ─── Get transaction history for a passenger ───────────────────────────────
  async getTransactions(passengerId: string, limit = 20) {
    const wallet = await this.getOrCreateWallet(passengerId);
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  // ─── Issue promo credit (admin campaigns) ──────────────────────────────────
  async issuePromoCredit(
    passengerId: string,
    amount: number,
    note: string,
    expiryDays?: number,
    campaignId?: string
  ): Promise<void> {
    const wallet = await this.getOrCreateWallet(passengerId);

    const expiresAt = expiryDays
      ? new Date(Date.now() + expiryDays * 86400000)
      : undefined;

    const balanceAfter = wallet.promoBalance + amount;

    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: { increment: amount } },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CREDIT_PROMO",
          amount,
          balanceAfter,
          expiresAt,
          promoCampaignId: campaignId,
          note,
        },
      }),
    ]);
  }

  // ─── Check monthly promo cap remaining ─────────────────────────────────────
  async getMonthlyCapRemaining(cap: number): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await this.prisma.walletTransaction.aggregate({
      where: {
        type: "CREDIT_PROMO",
        createdAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });

    const issuedThisMonth = result._sum.amount ?? 0;
    return Math.max(0, cap - issuedThisMonth);
  }

  // ─── Get wallet config from pricing settings ────────────────────────────────
  private async getWalletConfig() {
    try {
      const config = await (this.prisma as any).pricingConfig.findFirst({
        orderBy: { updatedAt: "desc" },
      });
      return {
        welcomeBonus: config?.walletWelcomeBonus ?? 25,
        monthlyPromoCap: config?.walletMonthlyPromoCap ?? 1000,
        bonusExpiryDays: config?.walletBonusExpiryDays ?? 90,
      };
    } catch {
      return { welcomeBonus: 25, monthlyPromoCap: 1000, bonusExpiryDays: 90 };
    }
  }
}
