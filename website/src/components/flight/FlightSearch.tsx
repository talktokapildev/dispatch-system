"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useId, useState } from "react";
import { cleanFlightNumber, dayLabel, ukDateOffset } from "@/lib/flightFormat";

/**
 * "Check flight" form on the dark band. Pressing the button is the only thing on the page
 * that can spend provider units (and only for a flight outside the cached board).
 */

type Outcome = "NOT_FOUND" | "INVALID" | "BUSY" | "LIMIT" | "ERROR" | null;

const MESSAGES: Record<Exclude<Outcome, null>, string> = {
  NOT_FOUND: "",
  INVALID: "That doesn't look like a flight number. Use the letters and numbers on the ticket, like EZY8687.",
  BUSY: "We can't check that flight just now. Please try again in a few minutes, or check with your airline.",
  LIMIT: "You've checked a lot of flights. Please try again in an hour.",
  ERROR: "Something went wrong. Please try again in a moment.",
};

export default function FlightSearch({
  defaultNumber = "",
  defaultDate,
}: {
  defaultNumber?: string;
  defaultDate?: string;
}) {
  const router = useRouter();
  const id = useId();
  const today = ukDateOffset(0);
  const quick = [
    { value: ukDateOffset(-1), label: `Yesterday · ${dayLabel(ukDateOffset(-1))}` },
    { value: today, label: `Today · ${dayLabel(today)}` },
    { value: ukDateOffset(1), label: `Tomorrow · ${dayLabel(ukDateOffset(1))}` },
  ];
  const initial = defaultDate ?? today;
  const initialQuick = quick.some((q) => q.value === initial);
  const [number, setNumber] = useState(defaultNumber);
  const [choice, setChoice] = useState(initialQuick ? initial : "other");
  const [otherDate, setOtherDate] = useState(initialQuick ? ukDateOffset(2) : initial);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [notFoundText, setNotFoundText] = useState("");

  const date = choice === "other" ? otherDate : choice;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = cleanFlightNumber(number);
    if (!n) return setOutcome("INVALID");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setOutcome("INVALID");
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/flight-status/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: n, date }),
      });
      const json = await res.json().catch(() => null);
      const status: string = json?.status ?? "ERROR";
      if (status === "FOUND") {
        router.push(`/flight-status/${n}?date=${date}`);
        return; // keep the button busy while the page loads
      }
      if (status === "NOT_FOUND") setNotFoundText(`We can't find ${n} landing at or leaving Gatwick on ${dayLabel(date)}.`);
      setOutcome((["NOT_FOUND", "INVALID", "BUSY", "LIMIT"].includes(status) ? status : "ERROR") as Outcome);
    } catch {
      setOutcome("ERROR");
    }
    setBusy(false);
  }

  const field =
    "h-[56px] w-full rounded-[14px] border-0 bg-white px-[18px] font-semibold text-ink outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-amber";
  const label = "flex flex-col gap-[6px] text-[13px] font-bold text-[#c4c9d1]";

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-[10px]">
        <label className={`${label} min-w-[200px] flex-[2_1_220px]`} htmlFor={`${id}-n`}>
          Flight number
          <input
            id={`${id}-n`}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. EZY8687"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={10}
            className={`${field} text-[20px] tracking-[0.02em] placeholder:font-medium placeholder:text-[#6b7280]`}
          />
        </label>
        <label className={`${label} min-w-[170px] flex-[1_1_190px]`} htmlFor={`${id}-d`}>
          Date
          <select id={`${id}-d`} value={choice} onChange={(e) => setChoice(e.target.value)} className={`${field} text-[17px]`}>
            {quick.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
            <option value="other">Another date…</option>
          </select>
        </label>
        {choice === "other" && (
          <label className={`${label} min-w-[170px] flex-[1_1_170px]`} htmlFor={`${id}-o`}>
            Pick a date
            <input
              id={`${id}-o`}
              type="date"
              value={otherDate}
              min={ukDateOffset(-2)}
              max={ukDateOffset(180)}
              onChange={(e) => setOtherDate(e.target.value)}
              className={`${field} text-[17px]`}
            />
          </label>
        )}
        <button
          type="submit"
          disabled={busy}
          className={`h-[56px] flex-[0_0_auto] rounded-[14px] bg-amber px-7 py-[14px] text-[18px] font-extrabold text-ink hover:bg-[#fbbf24] disabled:cursor-wait disabled:opacity-80 max-sm:w-full`}
        >
          {busy ? "Checking…" : "Check flight"}
        </button>
      </form>
      <div aria-live="polite" className="empty:hidden">
        {outcome && (
          <div className="rounded-[16px] bg-[#3a3f46] px-[18px] py-[14px] text-[15.5px] text-[#e5e7eb]">
            {outcome === "NOT_FOUND" ? (
              <>
                <strong className="text-white">{notFoundText}</strong>
                <ul className="m-0 mt-2 list-disc pl-5">
                  <li>Check the date: it&apos;s the day the flight lands at or leaves Gatwick.</li>
                  <li>Is it flying from Heathrow, Stansted or Luton instead?</li>
                  <li>Try the number without spaces, exactly as on the ticket.</li>
                </ul>
              </>
            ) : (
              MESSAGES[outcome]
            )}
          </div>
        )}
      </div>
    </div>
  );
}
