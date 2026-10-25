// backend/src/services/passengerRightsRules.ts
//
// "Your rights if this flight is badly delayed or cancelled" on the website's flight pages —
// PURE logic, no I/O (tests: scripts/test-passenger-rights.ts). The UK rules ("UK261") as the
// Civil Aviation Authority explains them (checked Oct 2026):
//   https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/delays/
//   https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/cancellations/
//
//   Covered: flights DEPARTING a UK airport (any airline); flights ARRIVING in the UK only on a UK or
//   EU airline (we can't tell the airline's nationality, so arrival pages say so).
//   Compensation for a delay: arriving 3+ hours late at the destination, per person, by great-circle
//   distance: under 1,500 km £220; 1,500–3,500 km £350; over 3,500 km £260 (3–4 h late) or £520
//   (4+ h). Not automatic (claim from the airline) and not due for extraordinary circumstances
//   (e.g. extreme weather, air traffic control strikes).
//   Care (food and drink, two calls or emails, hotel if overnight): from 2 / 3 / 4 hours late at
//   departure for the same distance bands. 5+ hours late: the passenger can choose a refund.
//   Cancelled: refund or re-routing, care; compensation possible when told less than 14 days before.
//
// We only say "may": the airline decides, and our times are estimates until the flight lands.
import type { BoardFlight, FlightView } from "./flightBoardRules";

export const LGW_LAT = 51.1537;
export const LGW_LON = -0.1821;

export type DistanceBand = "SHORT" | "MEDIUM" | "LONG"; // < 1,500 km · 1,500–3,500 km · > 3,500 km

export type PassengerRights = {
  covered: "YES" | "UK_EU_AIRLINE"; // departures always; arrivals only on a UK/EU airline
  distanceKm: number | null;
  band: DistanceBand | null;
  cancelled: boolean;
  // Delay at the DESTINATION (how compensation is measured), minutes; null when cancelled/unknown.
  arrivalDelayMin: number | null;
  arrivalDelayFinal: boolean; // true once the flight has actually arrived
  compensationGbp: number | null; // per person, if the delay stays as it is and the airline is at fault
  compensationIfLateGbp: number | null; // what 3+ hours late would mean (for "if it arrives 3h late…")
  // Departures from Gatwick only (where the passenger is when care is due):
  careFromMin: number | null; // care is due from this many minutes late at departure
  careDue: boolean;
  refundOption: boolean; // 5+ hours late at departure
};

const CARE_FROM: Record<DistanceBand, number> = { SHORT: 120, MEDIUM: 180, LONG: 240 };
const SHOW_FROM_MIN = 120; // nothing to say below 2 hours late (except a cancellation)

/** Great-circle distance in km (the CAA's method). */
export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bandFor(km: number): DistanceBand {
  return km < 1500 ? "SHORT" : km <= 3500 ? "MEDIUM" : "LONG";
}

/** Compensation for arriving `delayMin` late, or null below 3 hours. */
export function compensationFor(band: DistanceBand, delayMin: number): number | null {
  if (delayMin < 180) return null;
  if (band === "SHORT") return 220;
  if (band === "MEDIUM") return 350;
  return delayMin >= 240 ? 520 : 260;
}

const mins = (a: string | null | undefined, b: string | null | undefined): number | null => {
  if (!a || !b) return null;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((y - x) / 60_000) : null;
};

/**
 * The flight page's rights box, or null when there's nothing to say: less than 2 hours late
 * (at departure or arrival) and not cancelled, or a codeshare (the operating flight's page has it).
 */
export function passengerRights(f: BoardFlight, v: FlightView): PassengerRights | null {
  if (f.codeshare === "CODESHARE") return null; // the operating flight's page has it
  const departure = f.direction === "DEPARTURE";
  const cancelled = v.state === "CANCELLED";
  const km =
    f.other.lat != null && f.other.lon != null ? Math.round(greatCircleKm(LGW_LAT, LGW_LON, f.other.lat, f.other.lon)) : null;
  const band = km != null ? bandFor(km) : null;

  // Delay at the destination. Arrivals: our gate estimate at Gatwick (actual once landed).
  // Departures: the destination's own revised / landing time, else the departure delay carried over.
  let arrivalDelayMin: number | null = null;
  let arrivalDelayFinal = false;
  if (!cancelled) {
    if (!departure) {
      arrivalDelayMin = v.delayMin;
      arrivalDelayFinal = v.landed;
    } else {
      const landedThere = f.other.runwayUtc;
      const there = f.other.revisedUtc ?? (landedThere ? new Date(Date.parse(landedThere) + 7 * 60_000).toISOString() : null);
      arrivalDelayMin = mins(f.other.scheduledUtc, there) ?? v.delayMin;
      arrivalDelayFinal = !!landedThere;
    }
  }
  const departureDelay = departure && !cancelled ? v.delayMin : null;
  const worst = Math.max(arrivalDelayMin ?? 0, departureDelay ?? 0);
  if (!cancelled && worst < SHOW_FROM_MIN) return null;

  const careFromMin = departure && band ? CARE_FROM[band] : null;
  return {
    covered: departure ? "YES" : "UK_EU_AIRLINE",
    distanceKm: km,
    band,
    cancelled,
    arrivalDelayMin,
    arrivalDelayFinal,
    compensationGbp: band && arrivalDelayMin != null ? compensationFor(band, arrivalDelayMin) : null,
    compensationIfLateGbp: band ? compensationFor(band, Math.max(180, arrivalDelayMin ?? 0)) : null,
    careFromMin,
    careDue: careFromMin != null && departureDelay != null && departureDelay >= careFromMin,
    refundOption: departureDelay != null && departureDelay >= 300,
  };
}
