import { PrismaClient } from "@prisma/client";

// ─── Input types ──────────────────────────────────────────────────────────────

export interface FareEstimateInput {
  distanceMiles: number;
  durationMinutes: number;
  scheduledAt?: Date; // null/undefined = ASAP (use current time for premium check)

  // Airport supplements
  isGatwickPickup?: boolean;
  isGatwickDropoff?: boolean;
  isHeathrowPickup?: boolean;
  isHeathrowDropoff?: boolean;
  isMeetAndGreet?: boolean;

  // Pass-throughs
  isDartfordCrossing?: boolean;
  isCongestionCharge?: boolean;

  // Extras
  extraStops?: number;

  // Overrides (for corporate / care home, pass pre-calculated base)
  baseOverride?: number;
}

export interface FareEstimate {
  baseFare: number;
  distanceCharge: number;
  timeCharge: number;
  subtotal: number; // before premiums
  timePremiumAmount: number; // £ value of time premium
  timePremiumLabel: string; // e.g. "Night rate (25%)"
  supplements: { label: string; amount: number }[];
  total: number; // final customer-facing amount
  minimumApplied: boolean;
  breakdown: string[]; // human-readable line items
  driverEarning: number;
  platformFee: number;
}

export interface CareHomeFareEstimate {
  band: string;
  baseFare: number;
  supplements: { label: string; amount: number }[];
  total: number;
  breakdown: string[];
}

// ─── UK Bank Holidays 2025–2027 (extend as needed) ───────────────────────────
const UK_BANK_HOLIDAYS = new Set([
  "2025-01-01",
  "2025-04-18",
  "2025-04-21",
  "2025-05-05",
  "2025-05-26",
  "2025-08-25",
  "2025-12-25",
  "2025-12-26",
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-04",
  "2026-05-25",
  "2026-08-31",
  "2026-12-25",
  "2026-12-28",
  "2027-01-01",
  "2027-03-26",
  "2027-03-29",
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27",
  "2027-12-28",
]);

const CHRISTMAS_NYE_DATES = new Set(["12-24", "12-25", "12-26", "12-31"]);

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function toMonthDayKey(date: Date): string {
  return date.toISOString().slice(5, 10); // MM-DD
}

// ─── Default config (used if DB row not yet seeded) ───────────────────────────
const DEFAULT_CONFIG = {
  baseFare: 3.5,
  perMile: 1.8,
  perMinute: 0.2,
  minimumFare: 15.0,
  platformCommission: 0.15,
  nightPremium: 0.25,
  nightStartHour: 23,
  nightEndHour: 6,
  bankHolidayPremium: 0.25,
  christmasNyePremium: 0.75,
  gatwickDropoff: 10.0,
  gatwickPickup: 10.0,
  heathrowDropoff: 7.0,
  heathrowPickup: 7.0,
  meetAndGreet: 12.0,
  dartfordCrossing: 2.5,
  congestionCharge: 15.0,
  extraStopCharge: 5.0,
  freeWaitingMinutes: 10,
  waitingRatePerMinute: 0.5,
  retailCancelFreeMinutes: 15,
  accountCancelFreeHours: 2,
  careHomeUnder3miles: 15.0,
  careHome3to7miles: 22.0,
  careHome7to15miles: 32.0,
  careHome15to25miles: 48.0,
  careHome25to40miles: 70.0,
  careHomeHospitalDischarge: 10.0,
  careHomeHalfDay: 150.0,
  careHomeFullDay: 250.0,
  careHomeHourlyBeyondFull: 35.0,
};

type PricingConfigRow = typeof DEFAULT_CONFIG;

export class PricingService {
  constructor(private prisma: PrismaClient) {}

  // ─── Load config (with fallback to defaults) ──────────────────────────────
  async getConfig(): Promise<PricingConfigRow> {
    try {
      const config = await (this.prisma as any).pricingConfig.findFirst({
        orderBy: { updatedAt: "desc" },
      });
      return config ?? DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  // ─── Upsert config ────────────────────────────────────────────────────────
  async updateConfig(
    data: Partial<PricingConfigRow>,
    updatedBy?: string
  ): Promise<PricingConfigRow> {
    const existing = await (this.prisma as any).pricingConfig.findFirst();
    if (existing) {
      return (this.prisma as any).pricingConfig.update({
        where: { id: existing.id },
        data: { ...data, updatedBy },
      });
    }
    return (this.prisma as any).pricingConfig.create({
      data: { ...DEFAULT_CONFIG, ...data, updatedBy },
    });
  }

  // ─── Main fare estimate (Retail) ─────────────────────────────────────────
  async estimateFare(input: FareEstimateInput): Promise<FareEstimate> {
    const cfg = await this.getConfig();
    const now = input.scheduledAt ?? new Date();
    const breakdown: string[] = [];
    const supplements: { label: string; amount: number }[] = [];

    // 1. Base components
    const baseFare = cfg.baseFare;
    const distanceCharge = round2(input.distanceMiles * cfg.perMile);
    const timeCharge = round2(input.durationMinutes * cfg.perMinute);
    const subtotal = round2(baseFare + distanceCharge + timeCharge);

    breakdown.push(`Base fare: £${baseFare.toFixed(2)}`);
    breakdown.push(
      `Distance (${input.distanceMiles.toFixed(1)} mi × £${
        cfg.perMile
      }/mi): £${distanceCharge.toFixed(2)}`
    );
    breakdown.push(
      `Time (${input.durationMinutes} min × £${
        cfg.perMinute
      }/min): £${timeCharge.toFixed(2)}`
    );

    // 2. Time premium (applied to subtotal before supplements)
    let timePremiumAmount = 0;
    let timePremiumLabel = "";

    const londonTime = toLondonTime(now);
    const hour = londonTime.getHours();
    const dateKey = toDateKey(londonTime);
    const monthDay = toMonthDayKey(londonTime);

    if (CHRISTMAS_NYE_DATES.has(monthDay) && cfg.christmasNyePremium > 0) {
      timePremiumAmount = round2(subtotal * cfg.christmasNyePremium);
      timePremiumLabel = `Christmas/NYE premium (${pct(
        cfg.christmasNyePremium
      )})`;
    } else if (UK_BANK_HOLIDAYS.has(dateKey) && cfg.bankHolidayPremium > 0) {
      timePremiumAmount = round2(subtotal * cfg.bankHolidayPremium);
      timePremiumLabel = `Bank holiday premium (${pct(
        cfg.bankHolidayPremium
      )})`;
    } else if (
      isNightHour(hour, cfg.nightStartHour, cfg.nightEndHour) &&
      cfg.nightPremium > 0
    ) {
      timePremiumAmount = round2(subtotal * cfg.nightPremium);
      timePremiumLabel = `Night rate premium (${pct(cfg.nightPremium)})`;
    }

    if (timePremiumAmount > 0) {
      breakdown.push(`${timePremiumLabel}: £${timePremiumAmount.toFixed(2)}`);
    }

    const subtotalWithPremium = round2(subtotal + timePremiumAmount);

    // 3. Airport fees (fixed pass-throughs, not subject to time premium)
    if (input.isGatwickPickup)
      addSupplement(
        supplements,
        breakdown,
        "Gatwick pick-up fee",
        cfg.gatwickPickup
      );
    if (input.isGatwickDropoff)
      addSupplement(
        supplements,
        breakdown,
        "Gatwick drop-off fee",
        cfg.gatwickDropoff
      );
    if (input.isHeathrowPickup)
      addSupplement(
        supplements,
        breakdown,
        "Heathrow pick-up fee",
        cfg.heathrowPickup
      );
    if (input.isHeathrowDropoff)
      addSupplement(
        supplements,
        breakdown,
        "Heathrow drop-off fee",
        cfg.heathrowDropoff
      );
    if (input.isMeetAndGreet)
      addSupplement(supplements, breakdown, "Meet & Greet", cfg.meetAndGreet);

    // 4. Other pass-throughs
    if (input.isDartfordCrossing)
      addSupplement(
        supplements,
        breakdown,
        "Dartford Crossing",
        cfg.dartfordCrossing
      );
    if (input.isCongestionCharge)
      addSupplement(
        supplements,
        breakdown,
        "London Congestion Charge",
        cfg.congestionCharge
      );

    // 5. Extra stops
    if (input.extraStops && input.extraStops > 0) {
      const extraStopTotal = round2(input.extraStops * cfg.extraStopCharge);
      addSupplement(
        supplements,
        breakdown,
        `Extra stops (${input.extraStops} × £${cfg.extraStopCharge})`,
        extraStopTotal
      );
    }

    const supplementTotal = round2(
      supplements.reduce((sum, s) => sum + s.amount, 0)
    );

    // 6. Total with minimum fare check
    const rawTotal = round2(subtotalWithPremium + supplementTotal);
    const minimumApplied = rawTotal < cfg.minimumFare;
    const total = minimumApplied ? cfg.minimumFare : rawTotal;

    if (minimumApplied) {
      breakdown.push(`Minimum fare applied: £${cfg.minimumFare.toFixed(2)}`);
    }

    // 7. Driver earnings
    const platformFee = round2(total * cfg.platformCommission);
    const driverEarning = round2(total - platformFee);

    return {
      baseFare,
      distanceCharge,
      timeCharge,
      subtotal,
      timePremiumAmount,
      timePremiumLabel,
      supplements,
      total,
      minimumApplied,
      breakdown,
      driverEarning,
      platformFee,
    };
  }

  // ─── Care home flat-rate estimate ─────────────────────────────────────────
  async estimateCareHomeFare(
    distanceMiles: number,
    options?: {
      isHospitalDischarge?: boolean;
      extraStops?: number;
      waitingMinutesOverFree?: number;
      isHalfDay?: boolean;
      isFullDay?: boolean;
      extraHoursBeyondFullDay?: number;
    }
  ): Promise<CareHomeFareEstimate> {
    const cfg = await this.getConfig();
    const breakdown: string[] = [];
    const supplements: { label: string; amount: number }[] = [];

    // Distance band
    let band: string;
    let baseFare: number;

    if (options?.isFullDay) {
      band = "Full day (up to 8 hrs)";
      baseFare = cfg.careHomeFullDay;
    } else if (options?.isHalfDay) {
      band = "Half day (up to 4 hrs)";
      baseFare = cfg.careHomeHalfDay;
    } else if (distanceMiles < 3) {
      band = "Local short (under 3 mi)";
      baseFare = cfg.careHomeUnder3miles;
    } else if (distanceMiles < 7) {
      band = "Short (3–7 mi)";
      baseFare = cfg.careHome3to7miles;
    } else if (distanceMiles < 15) {
      band = "Medium (7–15 mi)";
      baseFare = cfg.careHome7to15miles;
    } else if (distanceMiles < 25) {
      band = "Longer (15–25 mi)";
      baseFare = cfg.careHome15to25miles;
    } else if (distanceMiles <= 40) {
      band = "Long (25–40 mi)";
      baseFare = cfg.careHome25to40miles;
    } else {
      // Beyond 40 miles — use longest band as base, warn
      band = "Extended (40+ mi)";
      baseFare = cfg.careHome25to40miles;
    }

    breakdown.push(`${band}: £${baseFare.toFixed(2)}`);

    if (options?.isHospitalDischarge) {
      addSupplement(
        supplements,
        breakdown,
        "Hospital discharge supplement",
        cfg.careHomeHospitalDischarge
      );
    }

    if (options?.extraStops && options.extraStops > 0) {
      const extraStopTotal = round2(options.extraStops * cfg.extraStopCharge);
      addSupplement(
        supplements,
        breakdown,
        `Extra stops (${options.extraStops} × £${cfg.extraStopCharge})`,
        extraStopTotal
      );
    }

    if (options?.waitingMinutesOverFree && options.waitingMinutesOverFree > 0) {
      const waitCharge = round2(
        options.waitingMinutesOverFree * cfg.waitingRatePerMinute
      );
      addSupplement(
        supplements,
        breakdown,
        `Waiting time (${options.waitingMinutesOverFree} min × £${cfg.waitingRatePerMinute}/min)`,
        waitCharge
      );
    }

    if (
      options?.extraHoursBeyondFullDay &&
      options.extraHoursBeyondFullDay > 0
    ) {
      const extraHourCharge = round2(
        options.extraHoursBeyondFullDay * cfg.careHomeHourlyBeyondFull
      );
      addSupplement(
        supplements,
        breakdown,
        `Extra hours beyond full day (${options.extraHoursBeyondFullDay} hrs × £${cfg.careHomeHourlyBeyondFull}/hr)`,
        extraHourCharge
      );
    }

    const supplementTotal = round2(
      supplements.reduce((sum, s) => sum + s.amount, 0)
    );
    const total = round2(baseFare + supplementTotal);

    return { band, baseFare, supplements, total, breakdown };
  }

  // ─── Driver earning split ────────────────────────────────────────────────
  async calculateDriverEarning(fare: number): Promise<{
    gross: number;
    platformFee: number;
    net: number;
  }> {
    const cfg = await this.getConfig();
    const platformFee = round2(fare * cfg.platformCommission);
    return {
      gross: fare,
      platformFee,
      net: round2(fare - platformFee),
    };
  }

  // ─── Waiting time charge (called at trip completion) ─────────────────────
  async calculateWaitingCharge(waitedMinutes: number): Promise<number> {
    const cfg = await this.getConfig();
    const billableMinutes = Math.max(0, waitedMinutes - cfg.freeWaitingMinutes);
    return round2(billableMinutes * cfg.waitingRatePerMinute);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}

function addSupplement(
  supplements: { label: string; amount: number }[],
  breakdown: string[],
  label: string,
  amount: number
) {
  supplements.push({ label, amount });
  breakdown.push(`${label}: £${amount.toFixed(2)}`);
}

function isNightHour(hour: number, start: number, end: number): boolean {
  // start = 23, end = 6 → night if hour >= 23 OR hour < 6
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function toLondonTime(date: Date): Date {
  // Convert UTC to Europe/London for correct night/premium checks
  try {
    const londonStr = date.toLocaleString("en-GB", {
      timeZone: "Europe/London",
    });
    return new Date(londonStr);
  } catch {
    return date;
  }
}
