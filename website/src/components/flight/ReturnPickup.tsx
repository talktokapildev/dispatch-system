"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReturnFlight } from "@/lib/flightFormat";
import { WHATSAPP_HREF } from "@/lib/site";

// "Coming back through Gatwick?" on departure pages: flights from the destination that landed at
// Gatwick this week (same airline first), and a pickup request for the visitor's return date.

const TERM = { NORTH: "North Terminal", SOUTH: "South Terminal" } as const;

function dayText(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)))
    .replace(",", "");
}

export default function ReturnPickup({
  returns,
  from,
  airline,
  minDate,
}: {
  returns: ReturnFlight[];
  from: string; // destination of the outbound flight = where they fly back from
  airline: string | null;
  minDate: string; // "YYYY-MM-DD": the outbound flight's date
}) {
  const [pick, setPick] = useState(returns[0]?.displayNumber ?? "");
  const [date, setDate] = useState("");
  const chosen = returns.find((r) => r.displayNumber === pick) ?? null;
  const top = returns[0] ?? null;
  const sameAirline = !!top && !!airline && top.airline.name === airline;

  const lines = [
    "Hi OrangeRide, I'd like a pickup from Gatwick:",
    chosen
      ? `Flight: ${chosen.displayNumber} from ${from}${date ? `, landing ${dayText(date)}` : ""} (usually around ${chosen.usualTimeUk}${chosen.terminal ? `, ${TERM[chosen.terminal]}` : ""})`
      : `Flight from ${from}${date ? ` on ${dayText(date)}` : ""}: (flight number)`,
    "Going to: ",
    "Passengers and bags: ",
  ];
  const href = `${WHATSAPP_HREF}?text=${encodeURIComponent(lines.join("\n"))}`;

  return (
    <section
      className="grid gap-6 rounded-[26px] border-[1.5px] border-[#f0a73a] bg-[#fffaf0] p-5 sm:p-7 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-center"
      aria-labelledby="return-heading"
    >
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#92400e]">COMING BACK THROUGH GATWICK?</span>
        <h2 id="return-heading" className="m-0 font-heading text-[clamp(22px,2.4vw,28px)] font-bold leading-[1.12] text-[#7c2d12]">
          {top
            ? `${sameAirline ? airline : top.airline.name ?? "Flights"} from ${from} usually ${sameAirline ? "lands" : "land"} at the ${top.terminal ? TERM[top.terminal] : "airport"} around ${top.usualTimeUk}`
            : `Flying back from ${from}? Book your Gatwick pickup now`}
        </h2>
        <p className="m-0 text-[16px] text-[#7c2d12]">
          {top
            ? `Seen on our Gatwick board this week. Book your pickup now: your driver tracks the flight and waits if it's late.`
            : "Tell us your return flight and date. Your driver tracks the flight and waits if it's late."}
        </p>
        {returns.length > 1 && (
          <fieldset className="m-0 mt-1 flex flex-wrap gap-2 border-0 p-0">
            <legend className="mb-1 text-[14px] font-bold text-[#92400e]">Your flight back</legend>
            {returns.map((r) => (
              <label
                key={r.displayNumber}
                className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-[15px] font-bold ${
                  pick === r.displayNumber ? "border-[#7c2d12] bg-white text-[#7c2d12]" : "border-[#f0a73a] text-[#7c2d12]"
                }`}
              >
                <input
                  type="radio"
                  name="return-flight"
                  value={r.displayNumber}
                  checked={pick === r.displayNumber}
                  onChange={() => setPick(r.displayNumber)}
                  className="accent-[#7c2d12]"
                />
                {r.displayNumber} · {r.usualTimeUk}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-[6px] text-[14px] font-bold text-[#92400e]">
          Your return date
          <input
            type="date"
            min={minDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-[52px] rounded-[12px] border-[1.5px] border-[#f0a73a] bg-white px-4 text-[16px] text-ink"
          />
        </label>
        <a
          href={href}
          className="flex min-h-[54px] items-center justify-center rounded-[14px] bg-ink px-4 text-center font-extrabold text-white no-underline hover:bg-[#1f2328] hover:text-white"
        >
          {chosen ? `Book a pickup for ${chosen.displayNumber}` : "Book a return pickup"}
        </a>
        {chosen && (
          <Link href={`/flight-status/${chosen.displayNumber}`} className="text-center text-[15px] font-bold text-[#92400e]">
            See {chosen.displayNumber}&apos;s flight status
          </Link>
        )}
      </div>
    </section>
  );
}
