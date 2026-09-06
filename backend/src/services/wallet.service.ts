import { PrismaClient } from "@prisma/client";

// ─── WalletService ────────────────────────────────────────────────────────────
// Handles all wallet operations: credit, debit, refund, expiry.
// Completely standalone — no imports from other services.
// Every method is wrapped in try/catch at call sites to ensure
// wallet failures never break existing booking/payment flows.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type PromoLot = {
  id: string;
  remainingAmount: number;
  expiresAt: Date | null;
  createdAt: Date;
};

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
      totalBalance: round2(wallet.promoBalance + wallet.realBalance),
      welcomeBonusPending: wallet.welcomeBonusPending,
      welcomeBonusIssued: wallet.welcomeBonusIssued,
    };
  }

  // ─── FIFO promo lot helpers ─────────────────────────────────────────────────
  // A "lot" is a CREDIT_PROMO WalletTransaction row with remainingAmount > 0.
  // Sorted soonest-expiring-first (nulls/no-expiry last), then oldest-first.
  private async getActivePromoLots(walletId: string): Promise<PromoLot[]> {
    const now = new Date();
    const lots = await this.prisma.walletTransaction.findMany({
      where: {
        walletId,
        type: "CREDIT_PROMO",
        remainingAmount: { gt: 0 },
      },
      select: {
        id: true,
        remainingAmount: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return lots
      .filter((lot) => !lot.expiresAt || lot.expiresAt > now)
      .map((lot) => ({
        ...lot,
        remainingAmount: lot.remainingAmount as number,
      }))
      .sort((a, b) => {
        const aExp = a.expiresAt ? a.expiresAt.getTime() : Infinity;
        const bExp = b.expiresAt ? b.expiresAt.getTime() : Infinity;
        if (aExp !== bExp) return aExp - bExp;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  // Plans (but does not write) how much of `amountNeeded` can be drawn from
  // the given lots, FIFO. Returns per-lot updates plus the total consumed.
  private planPromoConsumption(lots: PromoLot[], amountNeeded: number) {
    let remaining = round2(amountNeeded);
    const consumptions: { id: string; amount: number; newRemaining: number }[] =
      [];

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = round2(Math.min(lot.remainingAmount, remaining));
      if (take <= 0) continue;
      consumptions.push({
        id: lot.id,
        amount: take,
        newRemaining: round2(lot.remainingAmount - take),
      });
      remaining = round2(remaining - take);
    }

    return {
      consumptions,
      totalConsumed: round2(amountNeeded - remaining),
      shortfall: remaining,
    };
  }

  // ─── Process welcome bonus after first completed trip ──────────────────────
  // Called from dispatch.service.ts on COMPLETED — wrapped in try/catch there.
  async processWelcomeBonus(passengerId: string): Promise<void> {
    const wallet = await this.getOrCreateWallet(passengerId);

    // Already issued or not pending — nothing to do
    if (!wallet.welcomeBonusPending || wallet.welcomeBonusIssued) return;

    const config = await this.getWalletConfig();

    const capRemaining = await this.getMonthlyCapRemaining(
      config.monthlyPromoCap
    );
    if (capRemaining < config.welcomeBonus) {
      await this.prisma.walletAccount.update({
        where: { passengerId },
        data: { welcomeBonusPending: false },
      });
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.bonusExpiryDays);

    const newPromoBalance = round2(wallet.promoBalance + config.welcomeBonus);

    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: {
          promoBalance: newPromoBalance,
          welcomeBonusPending: false,
          welcomeBonusIssued: true,
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CREDIT_PROMO",
          amount: config.welcomeBonus,
          remainingAmount: config.welcomeBonus,
          balanceAfter: round2(newPromoBalance + wallet.realBalance),
          expiresAt,
          note: "Welcome bonus",
        },
      }),
    ]);
  }

  // ─── Debit wallet for a trip (promo lots FIFO, then real balance) ──────────
  // Returns false with no changes made if promo + real can't cover the full
  // amount. Used directly for non-cash flows; the cash flow uses
  // settleCashTrip below instead, which also handles over/underpayment.
  async debitTrip(
    passengerId: string,
    amount: number,
    bookingId: string
  ): Promise<boolean> {
    const wallet = await this.getOrCreateWallet(passengerId);
    const lots = await this.getActivePromoLots(wallet.id);
    const { consumptions, totalConsumed: promoApplied } =
      this.planPromoConsumption(lots, amount);

    const remainderAfterPromo = round2(amount - promoApplied);
    const realAvailable = wallet.realBalance > 0 ? wallet.realBalance : 0;
    const realApplied =
      remainderAfterPromo > 0
        ? round2(Math.min(realAvailable, remainderAfterPromo))
        : 0;
    const stillShort = round2(remainderAfterPromo - realApplied);

    if (stillShort > 0) {
      // Not enough combined promo + real balance — no changes made.
      return false;
    }

    const newPromoBalance = round2(wallet.promoBalance - promoApplied);
    const newRealBalance = round2(wallet.realBalance - realApplied);

    await this.prisma.$transaction([
      ...consumptions.map((c) =>
        this.prisma.walletTransaction.update({
          where: { id: c.id },
          data: { remainingAmount: c.newRemaining },
        })
      ),
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: newPromoBalance, realBalance: newRealBalance },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "DEBIT_TRIP",
          amount,
          balanceAfter: round2(newPromoBalance + newRealBalance),
          bookingId,
          note: `Trip payment (promo £${promoApplied.toFixed(
            2
          )}, real £${realApplied.toFixed(2)})`,
        },
      }),
    ]);

    return true;
  }

  // ─── Suggested cash collection (read-only, no writes) ──────────────────────
  // Applies promo-first-then-real against fare + any existing debt, and
  // returns what's left for the driver to collect in cash.
  async getSuggestedCashCollection(passengerId: string, fare: number) {
    const wallet = await this.getOrCreateWallet(passengerId);
    const lots = await this.getActivePromoLots(wallet.id);
    const promoAvailable = round2(
      lots.reduce((sum, l) => sum + l.remainingAmount, 0)
    );

    const priorDebt = wallet.realBalance < 0 ? round2(-wallet.realBalance) : 0;
    const totalOwed = round2(fare + priorDebt);

    const promoApplied = round2(Math.min(promoAvailable, totalOwed));
    const afterPromo = round2(totalOwed - promoApplied);

    const realAvailable = wallet.realBalance > 0 ? wallet.realBalance : 0;
    const realApplied = round2(Math.min(realAvailable, afterPromo));
    const amountToCollect = Math.max(0, round2(afterPromo - realApplied));

    return {
      promoApplied,
      realApplied,
      priorDebtApplied: priorDebt,
      amountToCollect,
    };
  }

  // ─── Settle a completed cash trip ───────────────────────────────────────────
  // Recomputes the wallet application fresh from live state (does not trust
  // any earlier suggestion), debits promo lots + real balance, records the
  // trip debit, then records the cash over/under as a separate CASH_ADJUSTMENT
  // row so the two effects (owed vs. actually collected) stay independently
  // auditable.
  async settleCashTrip(
    passengerId: string,
    bookingId: string,
    fare: number,
    actualCollected: number
  ): Promise<{
    promoApplied: number;
    realApplied: number;
    priorDebtApplied: number;
    expectedCollection: number;
    variance: number;
  }> {
    const wallet = await this.getOrCreateWallet(passengerId);
    const lots = await this.getActivePromoLots(wallet.id);

    const priorDebt = wallet.realBalance < 0 ? round2(-wallet.realBalance) : 0;
    const totalOwed = round2(fare + priorDebt);

    const { consumptions, totalConsumed: promoApplied } =
      this.planPromoConsumption(lots, totalOwed);
    const afterPromo = round2(totalOwed - promoApplied);

    const realAvailable = wallet.realBalance > 0 ? wallet.realBalance : 0;
    const realApplied = round2(Math.min(realAvailable, afterPromo));
    const expectedCollection = Math.max(0, round2(afterPromo - realApplied));

    // Clears whatever debt existed (or spends whatever real credit existed —
    // the two states are mutually exclusive) back to a zero baseline.
    const realBalanceAfterDebit = round2(
      wallet.realBalance + priorDebt - realApplied
    );

    const variance = round2(actualCollected - expectedCollection); // + overpaid, - underpaid
    const finalRealBalance = round2(realBalanceAfterDebit + variance);
    const newPromoBalance = round2(wallet.promoBalance - promoApplied);

    await this.prisma.$transaction([
      ...consumptions.map((c) =>
        this.prisma.walletTransaction.update({
          where: { id: c.id },
          data: { remainingAmount: c.newRemaining },
        })
      ),
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: newPromoBalance, realBalance: finalRealBalance },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "DEBIT_TRIP",
          amount: totalOwed,
          balanceAfter: round2(newPromoBalance + realBalanceAfterDebit),
          bookingId,
          note: `Cash trip settlement (promo £${promoApplied.toFixed(
            2
          )}, real £${realApplied.toFixed(2)}${
            priorDebt > 0 ? `, cleared prior debt £${priorDebt.toFixed(2)}` : ""
          })`,
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CASH_ADJUSTMENT",
          amount: variance,
          balanceAfter: round2(newPromoBalance + finalRealBalance),
          bookingId,
          note:
            variance > 0
              ? `Cash overpaid by £${variance.toFixed(2)}`
              : variance < 0
              ? `Cash underpaid by £${Math.abs(variance).toFixed(2)}`
              : "Exact cash collected",
        },
      }),
    ]);

    return {
      promoApplied,
      realApplied,
      priorDebtApplied: priorDebt,
      expectedCollection,
      variance,
    };
  }

  // ─── Sweep expired promo credit (daily cron) ────────────────────────────────
  async sweepExpiredPromoCredit(): Promise<{
    walletsSwept: number;
    totalExpired: number;
  }> {
    const now = new Date();
    const expiredLots = await this.prisma.walletTransaction.findMany({
      where: {
        type: "CREDIT_PROMO",
        remainingAmount: { gt: 0 },
        expiresAt: { lt: now },
      },
      select: { id: true, walletId: true, remainingAmount: true },
    });

    if (expiredLots.length === 0) return { walletsSwept: 0, totalExpired: 0 };

    const byWallet = new Map<string, typeof expiredLots>();
    for (const lot of expiredLots) {
      const list = byWallet.get(lot.walletId) ?? [];
      list.push(lot);
      byWallet.set(lot.walletId, list);
    }

    let totalExpired = 0;

    for (const [walletId, lots] of byWallet) {
      const wallet = await this.prisma.walletAccount.findUnique({
        where: { id: walletId },
      });
      if (!wallet) continue;

      const expiredAmount = round2(
        lots.reduce((sum, l) => sum + (l.remainingAmount as number), 0)
      );
      const newPromoBalance = round2(
        Math.max(0, wallet.promoBalance - expiredAmount)
      );

      await this.prisma.$transaction([
        ...lots.map((l) =>
          this.prisma.walletTransaction.update({
            where: { id: l.id },
            data: { remainingAmount: 0 },
          })
        ),
        this.prisma.walletAccount.update({
          where: { id: walletId },
          data: { promoBalance: newPromoBalance },
        }),
        this.prisma.walletTransaction.create({
          data: {
            walletId,
            type: "EXPIRY",
            amount: expiredAmount,
            balanceAfter: round2(newPromoBalance + wallet.realBalance),
            note: `${lots.length} promo lot(s) expired`,
          },
        }),
      ]);

      totalExpired = round2(totalExpired + expiredAmount);
    }

    return { walletsSwept: byWallet.size, totalExpired };
  }

  // ─── Manual admin balance correction ────────────────────────────────────────
  async adminAdjustBalance(
    passengerId: string,
    amount: number,
    balanceType: "promo" | "real",
    note: string,
    adminUserId: string
  ): Promise<void> {
    const wallet = await this.getOrCreateWallet(passengerId);

    if (balanceType === "real") {
      const newRealBalance = round2(wallet.realBalance + amount);
      await this.prisma.$transaction([
        this.prisma.walletAccount.update({
          where: { passengerId },
          data: { realBalance: newRealBalance },
        }),
        this.prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "REFUND_ADMIN",
            amount,
            balanceAfter: round2(wallet.promoBalance + newRealBalance),
            note: `Admin adjustment (real): ${note} [by ${adminUserId}]`,
          },
        }),
      ]);
      return;
    }

    // Promo adjustment
    if (amount >= 0) {
      // Credit — a fresh, non-expiring lot (manual corrections don't expire).
      const newPromoBalance = round2(wallet.promoBalance + amount);
      await this.prisma.$transaction([
        this.prisma.walletAccount.update({
          where: { passengerId },
          data: { promoBalance: newPromoBalance },
        }),
        this.prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "REFUND_ADMIN",
            amount,
            remainingAmount: amount,
            balanceAfter: round2(newPromoBalance + wallet.realBalance),
            note: `Admin adjustment (promo): ${note} [by ${adminUserId}]`,
          },
        }),
      ]);
    } else {
      // Debit — draw down existing lots FIFO. Capped at whatever's actually
      // active; can't push promo negative.
      const lots = await this.getActivePromoLots(wallet.id);
      const { consumptions, totalConsumed } = this.planPromoConsumption(
        lots,
        Math.abs(amount)
      );
      const newPromoBalance = round2(wallet.promoBalance - totalConsumed);

      await this.prisma.$transaction([
        ...consumptions.map((c) =>
          this.prisma.walletTransaction.update({
            where: { id: c.id },
            data: { remainingAmount: c.newRemaining },
          })
        ),
        this.prisma.walletAccount.update({
          where: { passengerId },
          data: { promoBalance: newPromoBalance },
        }),
        this.prisma.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "REFUND_ADMIN",
            amount: -totalConsumed,
            balanceAfter: round2(newPromoBalance + wallet.realBalance),
            note: `Admin adjustment (promo): ${note} [by ${adminUserId}]`,
          },
        }),
      ]);
    }
  }

  // ─── Refund wallet on cancellation ─────────────────────────────────────────
  // NOTE: not FIFO-lot-aware — increments the promoBalance aggregate without
  // touching any lot's remainingAmount. Fine as long as this stays uncalled
  // in the cash flow (debit only happens at completion, per Phase 1 design),
  // but flagging: if this ever fires, it'll drift the aggregate away from the
  // sum of active lots that getSuggestedCashCollection/settleCashTrip trust.
  async refundCancel(
    passengerId: string,
    amount: number,
    bookingId: string
  ): Promise<void> {
    const wallet = await this.getOrCreateWallet(passengerId);

    const originalCredit = await this.prisma.walletTransaction.findFirst({
      where: { walletId: wallet.id, type: "CREDIT_PROMO" },
      orderBy: { createdAt: "desc" },
    });

    const newPromoBalance = round2(wallet.promoBalance + amount);

    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: newPromoBalance },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "REFUND_CANCEL",
          amount,
          balanceAfter: round2(newPromoBalance + wallet.realBalance),
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

    const newPromoBalance = round2(wallet.promoBalance + amount);

    await this.prisma.$transaction([
      this.prisma.walletAccount.update({
        where: { passengerId },
        data: { promoBalance: newPromoBalance },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "CREDIT_PROMO",
          amount,
          remainingAmount: amount,
          balanceAfter: round2(newPromoBalance + wallet.realBalance),
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
