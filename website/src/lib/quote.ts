// Website quote calculator: calls to the OrangeRide backend + the WhatsApp message.
// The backend works out the route and the fare; the browser only sends Google place IDs.

import { WHATSAPP_HREF } from "./site";

/** Backend base URL (public). Override with NEXT_PUBLIC_API_URL, e.g. for local testing. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://backend-production-baf2.up.railway.app/api/v1";

export type Suggestion = { placeId: string; mainText: string; secondaryText: string };
export type PlaceChoice = { placeId: string; label: string };

export type QuoteResult =
  | {
      status: "QUOTED";
      ref: string;
      pickupAddress: string;
      dropoffAddress: string;
      miles: number;
      minutes: number;
      fromPrice: number;
      pickupAt: string | null;
      premiumLabel: string | null;
      tooSoon: boolean;
    }
  | { status: "OUT_OF_AREA"; ref: string; pickupAddress: string; dropoffAddress: string }
  | { status: "BUSY" };

export type QuoteRequest = {
  pickupPlaceId: string;
  dropoffPlaceId: string;
  date?: string;
  time?: string;
  passengers: number;
  bags: number;
  session?: string;
};

/** A token for one "typing → choosing" session (Google bills a session once). */
export function newSessionToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export async function fetchSuggestions(
  q: string,
  session: string,
  signal?: AbortSignal
): Promise<Suggestion[]> {
  const url = `${API_URL}/public/places/autocomplete?q=${encodeURIComponent(q)}&session=${encodeURIComponent(session)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

export async function requestQuote(
  body: QuoteRequest
): Promise<{ ok: true; data: QuoteResult } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_URL}/public/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) return { ok: true, data: json.data as QuoteResult };
    return {
      ok: false,
      error: json?.error ?? "We couldn't get a price just now. Message us on WhatsApp for a quote.",
    };
  } catch {
    return {
      ok: false,
      error: "We couldn't get a price just now. Message us on WhatsApp for a quote.",
    };
  }
}

export type DriveTimeResult =
  | { status: "OK"; from: string; minutes: number; miles: number }
  | { status: "OUT_OF_AREA"; from: string }
  | { status: "BUSY" };

/** Driving minutes from a town (quick pick) or a chosen address to a Gatwick terminal. */
export async function requestDriveTime(
  body: { terminal: "NORTH" | "SOUTH"; town?: string; placeId?: string; session?: string }
): Promise<{ ok: true; data: DriveTimeResult } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_URL}/public/drive-time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) return { ok: true, data: json.data as DriveTimeResult };
    return { ok: false, error: json?.error ?? "We couldn't work that out just now." };
  } catch {
    return { ok: false, error: "We couldn't work that out just now." };
  }
}

/** Quick-pick towns for "When to leave home" (slugs the backend knows). */
export const LEAVE_TOWNS: { slug: string; name: string }[] = [
  { slug: "crawley", name: "Crawley" },
  { slug: "horley", name: "Horley" },
  { slug: "horsham", name: "Horsham" },
  { slug: "redhill", name: "Redhill" },
  { slug: "reigate", name: "Reigate" },
  { slug: "east-grinstead", name: "East Grinstead" },
  { slug: "haywards-heath", name: "Haywards Heath" },
  { slug: "brighton", name: "Brighton" },
];

/** "Sat 24 Oct, 09:00" from the form's date + time (already UK time). */
export function whenText(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(dt);
  return `${day.replace(",", "")}, ${time}`;
}

/** The WhatsApp chat link with the trip already typed in. */
export function whatsappQuoteHref(t: {
  from: string;
  to: string;
  date: string;
  time: string;
  passengers: number;
  bags: number;
  price?: number;
  ref?: string;
}): string {
  const lines = [
    "Hi OrangeRide, I'd like to book:",
    `From: ${t.from}`,
    `To: ${t.to}`,
    `When: ${t.date && t.time ? whenText(t.date, t.time) : "date/time to confirm"}`,
    `Passengers: ${t.passengers}, large bags: ${t.bags}`,
  ];
  if (t.price !== undefined && t.ref) lines.push(`Website quote: from £${t.price} (ref ${t.ref})`);
  else if (t.ref) lines.push(`Website ref: ${t.ref}`);
  return `${WHATSAPP_HREF}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/** "about 25 min" / "about 1 hr 10 min" */
export function durationText(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${h} hr${m ? ` ${m} min` : ""}`;
}

/** Today's date in the UK as "YYYY-MM-DD" (for the date picker's minimum). */
export function ukToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}
