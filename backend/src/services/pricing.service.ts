import { PrismaClient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SurchargeZoneRow {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  pickupFee: number;
  dropoffFee: number;
  isActive: boolean;
  notes: string | null;
}

export interface FareEstimateInput {
  distanceMiles: number;
  durationMinutes: number;
  scheduledAt?: Date;

  // Coordinates for surcharge zone detection
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLatitude?: number;
  dropoffLongitude?: number;

  // Legacy flags (kept for backward compatibility)
  isGatwickPickup?: boolean;
  isGatwickDropoff?: boolean;
  isHeathrowPickup?: boolean;
  isHeathrowDropoff?: boolean;
  isMeetAndGreet?: boolean;
  isDartfordCrossing?: boolean;
  isCongestionCharge?: boolean;
  extraStops?: number;
  baseOverride?: number;
}

export interface FareEstimate {
  baseFare: number;
  distanceCharge: number;
  timeCharge: number;
  subtotal: number;
  timePremiumAmount: number;
  timePremiumLabel: string;
  supplements: { label: string; amount: number }[];
  total: number;
  minimumApplied: boolean;
  breakdown: string[];
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

// ─── UK Bank Holidays 2025–2027 ──────────────────────────────────────────────
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

const ZONES_CACHE_KEY = "surcharge_zones:active";
const ZONES_CACHE_TTL = 300; // 5 minutes

export class PricingService {
  constructor(private prisma: PrismaClient, private redis?: any) {}

  // ─── Config ───────────────────────────────────────────────────────────────
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

  // ─── Surcharge zones (Redis cached, 5 min TTL) ────────────────────────────
  async getSurchargeZones(): Promise<SurchargeZoneRow[]> {
    if (this.redis) {
      try {
        const cached = await this.redis.get(ZONES_CACHE_KEY);
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    try {
      const zones = await (this.prisma as any).surchargeZone.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });
      if (this.redis) {
        try {
          await this.redis.setex(
            ZONES_CACHE_KEY,
            ZONES_CACHE_TTL,
            JSON.stringify(zones)
          );
        } catch {}
      }
      return zones;
    } catch {
      return [];
    }
  }

  async invalidateZonesCache(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(ZONES_CACHE_KEY);
      } catch {}
    }
  }

  // ─── Find matching zone by coordinates ───────────────────────────────────
  private findMatchingZone(
    lat: number,
    lng: number,
    zones: SurchargeZoneRow[]
  ): SurchargeZoneRow | null {
    if (!lat || !lng) return null;
    for (const zone of zones) {
      if (
        haversineMeters(lat, lng, zone.latitude, zone.longitude) <=
        zone.radiusMeters
      )
        return zone;
    }
    return null;
  }

  // ─── Main fare estimate ───────────────────────────────────────────────────
  async estimateFare(input: FareEstimateInput): Promise<FareEstimate> {
    const cfg = await this.getConfig();
    const zones = await this.getSurchargeZones();
    const now = input.scheduledAt ?? new Date();
    const breakdown: string[] = [];
    const supplements: { label: string; amount: number }[] = [];

    // Base components
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

    // Time premium
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

    if (timePremiumAmount > 0)
      breakdown.push(`${timePremiumLabel}: £${timePremiumAmount.toFixed(2)}`);
    const subtotalWithPremium = round2(subtotal + timePremiumAmount);

    // Surcharge zones (coordinate-based, from DB)
    if (zones.length > 0) {
      if (input.pickupLatitude && input.pickupLongitude) {
        const zone = this.findMatchingZone(
          input.pickupLatitude,
          input.pickupLongitude,
          zones
        );
        if (zone && zone.pickupFee > 0)
          addSupplement(
            supplements,
            breakdown,
            `${zone.name} pick-up fee`,
            zone.pickupFee
          );
      }
      if (input.dropoffLatitude && input.dropoffLongitude) {
        const zone = this.findMatchingZone(
          input.dropoffLatitude,
          input.dropoffLongitude,
          zones
        );
        if (zone && zone.dropoffFee > 0)
          addSupplement(
            supplements,
            breakdown,
            `${zone.name} drop-off fee`,
            zone.dropoffFee
          );
      }
    } else {
      // Legacy fallback when no zones in DB
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
    }

    if (input.isMeetAndGreet)
      addSupplement(supplements, breakdown, "Meet & Greet", cfg.meetAndGreet);
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
    if (input.extraStops && input.extraStops > 0) {
      addSupplement(
        supplements,
        breakdown,
        `Extra stops (${input.extraStops} × £${cfg.extraStopCharge})`,
        round2(input.extraStops * cfg.extraStopCharge)
      );
    }

    const supplementTotal = round2(
      supplements.reduce((sum, s) => sum + s.amount, 0)
    );
    const rawTotal = round2(subtotalWithPremium + supplementTotal);
    const minimumApplied = rawTotal < cfg.minimumFare;
    const total = minimumApplied ? cfg.minimumFare : rawTotal;
    if (minimumApplied)
      breakdown.push(`Minimum fare applied: £${cfg.minimumFare.toFixed(2)}`);

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
      band = "Extended (40+ mi)";
      baseFare = cfg.careHome25to40miles;
    }

    breakdown.push(`${band}: £${baseFare.toFixed(2)}`);
    if (options?.isHospitalDischarge)
      addSupplement(
        supplements,
        breakdown,
        "Hospital discharge supplement",
        cfg.careHomeHospitalDischarge
      );
    if (options?.extraStops && options.extraStops > 0)
      addSupplement(
        supplements,
        breakdown,
        `Extra stops (${options.extraStops} × £${cfg.extraStopCharge})`,
        round2(options.extraStops * cfg.extraStopCharge)
      );
    if (options?.waitingMinutesOverFree && options.waitingMinutesOverFree > 0)
      addSupplement(
        supplements,
        breakdown,
        `Waiting time (${options.waitingMinutesOverFree} min × £${cfg.waitingRatePerMinute}/min)`,
        round2(options.waitingMinutesOverFree * cfg.waitingRatePerMinute)
      );
    if (options?.extraHoursBeyondFullDay && options.extraHoursBeyondFullDay > 0)
      addSupplement(
        supplements,
        breakdown,
        `Extra hours (${options.extraHoursBeyondFullDay} hrs × £${cfg.careHomeHourlyBeyondFull}/hr)`,
        round2(options.extraHoursBeyondFullDay * cfg.careHomeHourlyBeyondFull)
      );

    const supplementTotal = round2(
      supplements.reduce((sum, s) => sum + s.amount, 0)
    );
    return {
      band,
      baseFare,
      supplements,
      total: round2(baseFare + supplementTotal),
      breakdown,
    };
  }

  async calculateDriverEarning(
    fare: number
  ): Promise<{ gross: number; platformFee: number; net: number }> {
    const cfg = await this.getConfig();
    const platformFee = round2(fare * cfg.platformCommission);
    return { gross: fare, platformFee, net: round2(fare - platformFee) };
  }

  async calculateWaitingCharge(waitedMinutes: number): Promise<number> {
    const cfg = await this.getConfig();
    return round2(
      Math.max(0, waitedMinutes - cfg.freeWaitingMinutes) *
        cfg.waitingRatePerMinute
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function pct(d: number): string {
  return `${Math.round(d * 100)}%`;
}
function addSupplement(
  s: { label: string; amount: number }[],
  b: string[],
  label: string,
  amount: number
) {
  s.push({ label, amount });
  b.push(`${label}: £${amount.toFixed(2)}`);
}
function isNightHour(h: number, start: number, end: number): boolean {
  return start > end ? h >= start || h < end : h >= start && h < end;
}
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toMonthDayKey(d: Date): string {
  return d.toISOString().slice(5, 10);
}
function toLondonTime(date: Date): Date {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    return new Date(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
        "minute"
      )}:${get("second")}`
    );
  } catch {
    return date;
  }
}
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function deg2rad(d: number): number {
  return d * (Math.PI / 180);
}
