// Flight status page: calls to the OrangeRide backend. SERVER ONLY — it sends the secret
// site key, so never import this file from a "use client" component.
//
// Env (website service on Railway): FLIGHT_STATUS_SITE_KEY — the same value as the backend's.

import { API_URL } from "./quote";
import type { BoardData, FlightWithView, WeatherMap } from "./flightFormat";

export type FlightResult =
  | { status: "FOUND"; source: "BOARD" | "LOOKUP"; fetchedAt: string; flights: FlightWithView[]; weather?: WeatherMap }
  | { status: "NOT_IN_BOARD" }
  | { status: "INVALID" }
  | { status: "ERROR" };

export type LookupResult =
  | { status: "FOUND"; source: "BOARD" | "LOOKUP"; fetchedAt: string; flights: FlightWithView[] }
  | { status: "NOT_FOUND" | "INVALID" | "BUSY" | "LIMIT" | "ERROR" };

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-site-key": process.env.FLIGHT_STATUS_SITE_KEY ?? "", ...extra };
}

async function getJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.success ? json.data : null;
  } catch {
    return null;
  }
}

/** Gatwick arrivals and departures from the cached board; null if the backend can't be reached. */
export async function fetchBoard(): Promise<BoardData | null> {
  return getJson("/public/flight-status/board");
}

/** One flight from the cached board (or a cached "Check flight" result). Never costs units. */
export async function fetchFlight(number: string, date: string | null): Promise<FlightResult> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const data = await getJson(`/public/flight-status/flight/${encodeURIComponent(number)}${q}`);
  return data ?? { status: "ERROR" };
}

/** A person pressed "Check flight": the board first, otherwise ONE provider lookup (2 units). */
export async function lookupFlight(number: string, date: string, visitorIp: string | null): Promise<LookupResult> {
  try {
    const res = await fetch(`${API_URL}/public/flight-status/lookup`, {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json",
        ...(visitorIp ? { "x-visitor-ip": visitorIp } : {}),
      }),
      body: JSON.stringify({ number, date }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) return { status: "LIMIT" };
    const json = await res.json().catch(() => null);
    return res.ok && json?.success ? (json.data as LookupResult) : { status: "ERROR" };
  } catch {
    return { status: "ERROR" };
  }
}
