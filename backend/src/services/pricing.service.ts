import { PricingType, VehicleClass } from '@prisma/client'
import { PrismaClient } from '@prisma/client'

interface PriceEstimateInput {
  distanceKm: number
  durationMinutes: number
  vehicleClass?: VehicleClass
  pricingType?: PricingType
  isAirportPickup?: boolean
  isAirportDropoff?: boolean
  scheduledAt?: Date
}

interface PriceEstimate {
  baseFare: number
  distanceCharge: number
  timeCharge: number
  supplements: Record<string, number>
  subtotal: number
  total: number
  pricingType: PricingType
  vehicleClass: VehicleClass
  breakdown: string[]
}

export class PricingService {
  constructor(private prisma: PrismaClient) {}

  async estimateFare(input: PriceEstimateInput): Promise<PriceEstimate> {
    const vehicleClass = input.vehicleClass ?? VehicleClass.STANDARD
    const pricingType = input.pricingType ?? PricingType.FIXED

    // Fetch active pricing zone for vehicle class
    const zone = await this.prisma.pricingZone.findFirst({
      where: { vehicleClass, isActive: true },
    }) ?? this.getDefaultZone(vehicleClass)

    const distanceMiles = input.distanceKm * 0.621371
    const baseFare = zone.baseFare
    const distanceCharge = distanceMiles * zone.perMile
    const timeCharge = input.durationMinutes * zone.perMinute

    const supplements: Record<string, number> = {}
    const breakdown: string[] = [
      `Base fare: £${baseFare.toFixed(2)}`,
      `Distance (${distanceMiles.toFixed(1)} mi): £${distanceCharge.toFixed(2)}`,
    ]

    if (pricingType === PricingType.METERED) {
      breakdown.push(`Time (${input.durationMinutes} min): £${timeCharge.toFixed(2)}`)
    }

    // Airport supplements
    if (input.isAirportPickup && zone.airportPickupSupplement > 0) {
      supplements['Airport pickup'] = zone.airportPickupSupplement
      breakdown.push(`Airport pickup supplement: £${zone.airportPickupSupplement.toFixed(2)}`)
    }

    if (input.isAirportDropoff && zone.airportDropoffSupplement > 0) {
      supplements['Airport dropoff'] = zone.airportDropoffSupplement
      breakdown.push(`Airport dropoff supplement: £${zone.airportDropoffSupplement.toFixed(2)}`)
    }

    // Time-based supplements
    if (input.scheduledAt) {
      const hour = input.scheduledAt.getHours()
      const day = input.scheduledAt.getDay()

      if ((hour >= 22 || hour < 6) && zone.nightSupplement > 0) {
        const nightCharge = (baseFare + distanceCharge) * (zone.nightSupplement / 100)
        supplements['Night rate'] = nightCharge
        breakdown.push(`Night supplement (${zone.nightSupplement}%): £${nightCharge.toFixed(2)}`)
      }

      if ((day === 0 || day === 6) && zone.weekendSupplement > 0) {
        const weekendCharge = (baseFare + distanceCharge) * (zone.weekendSupplement / 100)
        supplements['Weekend rate'] = weekendCharge
        breakdown.push(`Weekend supplement (${zone.weekendSupplement}%): £${weekendCharge.toFixed(2)}`)
      }
    }

    const supplementTotal = Object.values(supplements).reduce((a, b) => a + b, 0)
    const subtotal = baseFare + distanceCharge + (pricingType === PricingType.METERED ? timeCharge : 0) + supplementTotal
    const total = Math.max(subtotal, zone.minimumFare)

    if (total === zone.minimumFare && subtotal < zone.minimumFare) {
      breakdown.push(`Minimum fare applied: £${zone.minimumFare.toFixed(2)}`)
    }

    return {
      baseFare,
      distanceCharge,
      timeCharge: pricingType === PricingType.METERED ? timeCharge : 0,
      supplements,
      subtotal,
      total: Math.round(total * 100) / 100,
      pricingType,
      vehicleClass,
      breakdown,
    }
  }

  calculateDriverEarning(fare: number, platformFeePercent: number = 15): {
    gross: number
    platformFee: number
    net: number
  } {
    const platformFee = Math.round(fare * (platformFeePercent / 100) * 100) / 100
    return {
      gross: fare,
      platformFee,
      net: Math.round((fare - platformFee) * 100) / 100,
    }
  }

  private getDefaultZone(vehicleClass: VehicleClass) {
    const defaults: Record<VehicleClass, typeof defaultZone> = {
      STANDARD: { baseFare: 3.50, perMile: 2.00, perMinute: 0.25, minimumFare: 5.00, airportPickupSupplement: 5, airportDropoffSupplement: 0, nightSupplement: 20, weekendSupplement: 10 },
      EXECUTIVE: { baseFare: 5.00, perMile: 3.00, perMinute: 0.40, minimumFare: 10.00, airportPickupSupplement: 10, airportDropoffSupplement: 0, nightSupplement: 20, weekendSupplement: 10 },
      MPV: { baseFare: 5.00, perMile: 2.50, perMinute: 0.35, minimumFare: 8.00, airportPickupSupplement: 8, airportDropoffSupplement: 0, nightSupplement: 20, weekendSupplement: 10 },
      MINIBUS: { baseFare: 8.00, perMile: 3.50, perMinute: 0.50, minimumFare: 15.00, airportPickupSupplement: 15, airportDropoffSupplement: 0, nightSupplement: 20, weekendSupplement: 10 },
    }
    const defaultZone = { baseFare: 3.50, perMile: 2.00, perMinute: 0.25, minimumFare: 5.00, airportPickupSupplement: 5, airportDropoffSupplement: 0, nightSupplement: 20, weekendSupplement: 10 }
    return defaults[vehicleClass] ?? defaultZone
  }
}
