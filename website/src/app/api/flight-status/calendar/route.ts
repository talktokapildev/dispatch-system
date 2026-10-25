// GET /api/flight-status/calendar?number=EZY8315&date=2026-10-27&dir=departure
// "Add to calendar" on flight pages: an .ics file for one flight, built from the same cached data
// as the page (the board or a recent "Check flight"; never a new provider call).
// Departures get a reminder an hour before "be at the airport by".

import { NextRequest, NextResponse } from "next/server";
import { cleanFlightNumber, placeName, shownNumber, terminalName } from "@/lib/flightFormat";
import { fetchFlight } from "@/lib/flightStatus";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/** 2026-10-27T08:15:00.000Z → 20261027T081500Z */
const icsTime = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Text values: escape \ ; , and newlines (RFC 5545). */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines longer than 75 octets are folded (continuation lines start with a space). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const number = cleanFlightNumber(q.get("number") ?? "");
  const date = q.get("date") ?? "";
  const dir = q.get("dir") === "arrival" ? "ARRIVAL" : "DEPARTURE";
  if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = await fetchFlight(number, date);
  if (r.status !== "FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hit = r.flights.find((x) => x.flight.direction === dir) ?? r.flights[0];
  const { flight: f, view: v } = hit;
  const num = shownNumber(f);
  const place = placeName(f.other);
  const term = terminalName(f.lgw.terminal);
  const departure = f.direction === "DEPARTURE";
  const page = `${SITE_URL}/flight-status/${num}?date=${date}`;

  const start = v.expectedAt ?? f.lgw.scheduledUtc; // leaves Gatwick / reaches the gate
  const end = departure
    ? f.other.revisedUtc ?? f.other.scheduledUtc ?? new Date(Date.parse(start) + 2 * 3_600_000).toISOString()
    : new Date(Date.parse(start) + 30 * 60_000).toISOString();
  const summary = departure ? `${num} to ${place}` : `${num} from ${place} lands at Gatwick`;
  const description = [
    departure
      ? `Leaves Gatwick${term ? ` ${term}` : ""}.${v.beThereBy ? ` Be at the airport by ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(v.beThereBy))} (UK time).` : ""}`
      : `Lands at Gatwick${term ? ` ${term}` : ""}.`,
    "Times can change: check live status and your airline before you travel.",
    page,
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OrangeRide//Flight status//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${num}-${date}-${dir.toLowerCase()}@orangeride.co.uk`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(new Date(start).toISOString())}`,
    `DTEND:${icsTime(new Date(end).toISOString())}`,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(`London Gatwick${term ? ` ${term}` : ""}`)}`,
    `DESCRIPTION:${esc(description)}`,
    `URL:${page}`,
  ];
  if (departure && v.beThereBy && Date.parse(v.beThereBy) > Date.now()) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(`Leave for Gatwick soon: ${num} to ${place}`)}`,
      `TRIGGER;VALUE=DATE-TIME:${icsTime(new Date(Date.parse(v.beThereBy) - 60 * 60_000).toISOString())}`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  return new NextResponse(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${num}-${date}.ics"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
