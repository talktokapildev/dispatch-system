"use client";

import { useEffect, useState } from "react";
import AddressField from "@/components/quote/AddressField";
import { LEAVE_SPARE_MIN, leaveByIso } from "@/lib/flightFormat";
import { LEAVE_TOWNS, newSessionToken, requestDriveTime, type PlaceChoice } from "@/lib/quote";
import { WHATSAPP_HREF } from "@/lib/site";

// "When to leave home" on departure pages: the visitor taps a nearby town or picks an address,
// we get the drive time to their terminal (backend, cached), and show the leave-by time with a
// booking link. The choice is remembered in this browser only (a convenience; never required).

const STORE_KEY = "orangeride:leave-from";
const BOOK_AHEAD_HOURS = 24;
const TZ = "Europe/London";

type From = { kind: "town"; slug: string; name: string } | { kind: "place"; placeId: string; name: string };
type Result =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; from: string; minutes: number; miles: number }
  | { state: "far"; from: string }
  | { state: "error"; message: string };

const hm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)).replace(",", "");

export default function LeavePlanner({
  terminal,
  beThereBy,
  flightLabel,
}: {
  terminal: "NORTH" | "SOUTH" | null;
  beThereBy: string;
  flightLabel: string; // "EZY8315 to Pisa, Tue 27 Oct 09:15"
}) {
  const term = terminal ?? "NORTH";
  const termName = term === "NORTH" ? "North Terminal" : "South Terminal";
  const [from, setFrom] = useState<From | null>(null);
  const [place, setPlace] = useState<PlaceChoice | null>(null);
  const [session, setSession] = useState(newSessionToken);
  const [result, setResult] = useState<Result>({ state: "idle" });

  // Remembered start point (this browser only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as From;
        if (saved?.kind === "town" && LEAVE_TOWNS.some((t) => t.slug === saved.slug)) setFrom(saved);
      }
    } catch {
      /* storage unavailable: start empty */
    }
  }, []);

  useEffect(() => {
    if (!from) return;
    let live = true;
    setResult({ state: "loading" });
    requestDriveTime(
      from.kind === "town" ? { terminal: term, town: from.slug } : { terminal: term, placeId: from.placeId, session }
    ).then((r) => {
      if (!live) return;
      if (!r.ok) return setResult({ state: "error", message: r.error });
      if (r.data.status === "OK") return setResult({ state: "ok", from: r.data.from, minutes: r.data.minutes, miles: r.data.miles });
      if (r.data.status === "OUT_OF_AREA") return setResult({ state: "far", from: r.data.from });
      setResult({ state: "error", message: "We can't work that out just now. Try again later." });
    });
    if (from.kind === "place") setSession(newSessionToken()); // next search is a new Google session
    try {
      if (from.kind === "town") window.localStorage.setItem(STORE_KEY, JSON.stringify(from));
    } catch {
      /* ignore */
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, term]);

  const pickTown = (slug: string, name: string) => {
    setPlace(null);
    setFrom({ kind: "town", slug, name });
  };
  const pickPlace = (p: PlaceChoice | null) => {
    setPlace(p);
    if (p) setFrom({ kind: "place", placeId: p.placeId, name: p.label });
  };

  const leave = result.state === "ok" ? leaveByIso(beThereBy, result.minutes) : null;
  const bookable = leave ? Date.parse(leave) - Date.now() >= BOOK_AHEAD_HOURS * 3_600_000 : false;
  const fromName = from?.kind === "town" ? from.name : result.state === "ok" ? result.from : from?.name ?? "";
  const bookHref =
    leave &&
    `${WHATSAPP_HREF}?text=${encodeURIComponent(
      [
        "Hi OrangeRide, I'd like a lift to Gatwick:",
        `Flight: ${flightLabel} (${termName})`,
        `Pickup from: ${fromName}`,
        `Pickup time: ${day(leave)} ${hm(leave)}`,
        "Passengers and bags: ",
      ].join("\n")
    )}`;

  const chip = (on: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-[1.5px] px-4 text-[15px] font-bold ${
      on ? "border-ink bg-ink text-white" : "border-[#cbd5e1] bg-white text-ink hover:border-[#94a3b8]"
    }`;

  return (
    <section
      className="grid gap-6 rounded-[26px] border border-line bg-white p-5 sm:p-7 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
      aria-labelledby="leave-heading"
    >
      <div className="flex flex-col gap-3">
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-accent-dark">WHEN TO LEAVE HOME</span>
        <h2 id="leave-heading" className="m-0 font-heading text-[clamp(22px,2.4vw,28px)] font-bold tracking-[-0.02em] text-ink">
          Where are you leaving from?
        </h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Nearby towns">
          {LEAVE_TOWNS.map((t) => (
            <button
              key={t.slug}
              type="button"
              aria-pressed={from?.kind === "town" && from.slug === t.slug}
              onClick={() => pickTown(t.slug, t.name)}
              className={chip(from?.kind === "town" && from.slug === t.slug)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <AddressField
          label="Or your address or postcode"
          placeholder="e.g. RH10 1AA"
          value={place}
          onChange={pickPlace}
          session={session}
          pinColor="#e06800"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-[22px] bg-ink p-5 text-[#d1d5db] sm:p-6" aria-live="polite">
        {result.state === "idle" && (
          <p className="m-0 my-auto text-[16px]">
            Choose a town or address and we&apos;ll work out when to leave to reach the {termName} by {hm(beThereBy)}.
          </p>
        )}
        {result.state === "loading" && <p className="m-0 my-auto text-[16px]">Working it out…</p>}
        {result.state === "error" && <p className="m-0 my-auto text-[16px]">{result.message}</p>}
        {result.state === "far" && (
          <p className="m-0 my-auto text-[16px]">
            {result.from} is outside the area we cover. Allow plenty of time, and check the drive on a map before you set off.
          </p>
        )}
        {result.state === "ok" && leave && (
          <>
            <span className="text-[14.5px] text-[#c4c9d1]">
              From {fromName} to the {termName}
            </span>
            <div className="flex items-baseline gap-3">
              <span className="text-[18px] font-bold text-white">Leave by</span>
              <strong className="font-heading text-[clamp(44px,5vw,56px)] leading-none text-white">{hm(leave)}</strong>
            </div>
            <dl className="m-0 flex flex-col gap-1 border-t border-[#4a5058] pt-3 text-[15px]">
              <div className="flex justify-between gap-3">
                <dt>Drive ({result.miles} miles)</dt>
                <dd className="m-0 font-bold text-white">about {result.minutes} min</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Spare time</dt>
                <dd className="m-0 font-bold text-white">{LEAVE_SPARE_MIN} min</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>At the terminal by</dt>
                <dd className="m-0 font-bold text-white">{hm(beThereBy)}</dd>
              </div>
            </dl>
            {bookable ? (
              <a
                href={bookHref!}
                className="mt-1 flex min-h-[54px] items-center justify-center rounded-[14px] bg-amber px-4 text-center text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink"
              >
                Book a car for {hm(leave)}
              </a>
            ) : (
              <a
                href={WHATSAPP_HREF}
                className="mt-1 flex min-h-[54px] items-center justify-center rounded-[14px] border-[1.5px] border-[#6b7280] px-4 text-center font-bold text-white no-underline hover:text-white"
              >
                Less than 24 hours away: ask us on WhatsApp
              </a>
            )}
            <span className="text-center text-[13.5px] text-[#c4c9d1]">
              Fixed fare, dropped at the terminal door. Drive time without traffic delays: allow more at busy times.
            </span>
          </>
        )}
      </div>
    </section>
  );
}
