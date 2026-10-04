// passenger-app/src/lib/airport.ts
//
// Shared types + helpers for airport pickups (flight capture).
// Times at the airport are always shown in UK time, whatever timezone the
// passenger's phone is set to (e.g. booking from abroad before flying home).

export type Terminal = "NORTH" | "SOUTH";
export type LuggageType = "HAND" | "CHECKED";

export type MeetingPoint = {
  id: string;
  terminal: Terminal | string;
  name: string;
  instructions: string;
  latitude: number;
  longitude: number;
};

export type AirportInfo = {
  airportIata: string;
  airportName: string;
  meetingPoints: MeetingPoint[];
};

export type FlightLookup = {
  flight: {
    flightNumber: string;
    airlineName: string | null;
    originIata: string | null;
    originName: string | null;
    scheduledArrivalUtc: string;
    terminal: Terminal | null;
    status: string | null;
  };
  suggestedMeetingPoint: MeetingPoint | null;
  meetingPoints: MeetingPoint[];
  buffers: { hand: number; checked: number };
  earliestPickupUtc: { hand: string; checked: string };
  tooSoonToSchedule: { hand: boolean; checked: boolean };
};

/** What HomeScreen / BookingConfirm need to know about an airport pickup. */
export type AirportBookingState = {
  airportName: string;
  meetingPoint: MeetingPoint | null;
  flight: {
    flightNumber: string; // passenger's input, sent to the backend
    flightDate: string; // YYYY-MM-DD, arrival date (UK)
    luggageType: LuggageType;
    display: string; // e.g. "U2 8004 · easyJet"
    originName: string | null;
    scheduledArrivalUtc: string;
    bufferMinutes: number;
  } | null;
  ready: boolean; // can the passenger continue to Confirm?
  message: string | null; // why not, if not ready
};

export const TERMINAL_LABEL: Record<string, string> = {
  NORTH: "North Terminal",
  SOUTH: "South Terminal",
};

export function meetingPointAddress(
  airportName: string,
  mp: MeetingPoint
): string {
  return `${airportName} ${TERMINAL_LABEL[mp.terminal] ?? mp.terminal}: ${
    mp.name
  }`;
}

export function ukTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

export function ukDayTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

/** Local calendar date of a Date as YYYY-MM-DD (for the flight-date picker). */
export function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
