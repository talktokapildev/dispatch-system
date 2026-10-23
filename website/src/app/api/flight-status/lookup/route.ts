// POST /api/flight-status/lookup { number, date } — the "Check flight" button.
// Forwards to the backend with the secret site key (kept on the server) and the visitor's IP
// for the per-visitor limit. In production only our own pages may call it (Origin check).
// Extra origins for testing a production build locally:
//   FLIGHT_STATUS_EXTRA_ORIGINS="http://localhost:3100"

import { NextRequest, NextResponse } from "next/server";
import { cleanFlightNumber } from "@/lib/flightFormat";
import { lookupFlight } from "@/lib/flightStatus";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  SITE_URL,
  "https://www.orangeride.co.uk",
  ...(process.env.FLIGHT_STATUS_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

/** Right-most X-Forwarded-For entry: added by Railway's proxy, so the visitor can't fake it. */
function visitorIp(req: NextRequest): string | null {
  const xff = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return xff.length ? xff[xff.length - 1].slice(0, 64) : null;
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !ALLOWED_ORIGINS.includes(req.headers.get("origin") ?? ""))
    return NextResponse.json({ status: "ERROR" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const number = cleanFlightNumber(String(body?.number ?? ""));
  const date = String(body?.date ?? "");
  if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ status: "INVALID" });

  const result = await lookupFlight(number, date, visitorIp(req));
  // The page itself is rendered from the backend, so only the outcome goes back to the browser.
  return NextResponse.json({ status: result.status, number, date });
}
