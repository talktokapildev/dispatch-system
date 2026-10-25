import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AirlineTag } from "@/components/flight/bits";
import { breadcrumbs, JsonLd } from "@/components/flight/JsonLd";
import { DarkBand, h2 } from "@/components/flight/ui";
import { BookBand, CHANGE_QA, MeetingPoints, QuestionList, SHUTTLE_QA, TerminalPill, TICKET_QA } from "@/components/terminals/parts";
import { AirlineTerminal, ago, cleanFlightNumber, daysCovered, lastDays } from "@/lib/flightFormat";
import { fetchTerminals } from "@/lib/flightStatus";
import PunctualityRanking from "@/components/terminals/PunctualityRanking";
import { hubOnTime } from "@/components/flight/Punctuality";
import { pageMetadata } from "@/lib/seo";

// Rendered on every request from the backend's cached summary (Redis only, no provider units).
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata(
  "/gatwick/terminals",
  "Gatwick North or South Terminal? Check Your Airline",
  "Which Gatwick terminal does your airline use? easyJet, British Airways, TUI, Wizz Air and more, from this week's flights. Plus getting between the terminals and where to meet your driver.",
);

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** What a visitor typed → an airline (exact name, code or page name first, then a partial name). */
function findAirline(airlines: AirlineTerminal[], q: string): AirlineTerminal | null {
  const n = norm(q);
  if (!n) return null;
  const code = q.trim().toUpperCase();
  const exact = airlines.find((a) => norm(a.name) === n || a.slug === n.replace(/ /g, "-") || a.codes.includes(code));
  if (exact) return exact;
  return n.length >= 3 ? airlines.find((a) => norm(a.name).includes(n)) ?? null : null;
}

export default async function TerminalsPage({ searchParams }: { searchParams: { q?: string; rank?: string } }) {
  const now = new Date();
  const summary = await fetchTerminals();
  const airlines = summary?.airlines ?? [];
  const q = (searchParams.q ?? "").slice(0, 60);

  // Search: an airline → its page (or its row here); a flight number → that flight's page.
  let notFound: string | null = null;
  let picked: AirlineTerminal | null = null;
  if (q.trim()) {
    const airline = findAirline(airlines, q);
    const flight = cleanFlightNumber(q);
    if (airline?.hasPage) redirect(`/gatwick/terminals/${airline.slug}`);
    if (airline) picked = airline;
    else if (flight) redirect(`/flight-status/${flight}`);
    else notFound = q.trim();
  }

  const days = airlines.length ? Math.max(...airlines.map((a) => daysCovered(a.firstDate, now))) : 7;
  const north = airlines.filter((a) => a.terminal === "NORTH");
  const south = airlines.filter((a) => a.terminal === "SOUTH");
  const big = airlines.filter((a) => a.hasPage);
  const faq = [
    ...big.slice(0, 4).map((a) => ({
      q: `Which terminal is ${a.name} at Gatwick?`,
      a:
        a.terminal === "BOTH"
          ? `${a.name} uses both terminals, depending on the flight. Check your booking or search for your flight number.`
          : a.terminal
            ? `The ${a.terminal === "NORTH" ? "North" : "South"} Terminal, from ${a.flights} ${a.name} flights ${lastDays(daysCovered(a.firstDate, now))}.`
            : `Gatwick hasn't published it for this week's ${a.name} flights yet. Check your booking.`,
    })),
    TICKET_QA,
    SHUTTLE_QA,
    CHANGE_QA,
  ];

  return (
    <>
      <JsonLd data={breadcrumbs([{ name: "Gatwick terminals", path: "/gatwick/terminals" }])} />
      <DarkBand heading="Gatwick North or South Terminal?" eyebrow="GATWICK TERMINALS · BY AIRLINE">
        <form action="/gatwick/terminals" method="get" className="flex flex-wrap items-end gap-[10px]" role="search">
          <label className="flex min-w-[240px] flex-[2_1_260px] flex-col gap-[6px] text-[13px] font-bold text-[#c4c9d1]">
            Airline or flight number
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="e.g. easyJet, BA or EZY8687"
              autoComplete="off"
              className="h-14 rounded-[14px] border-0 bg-white px-[18px] text-[18px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="h-14 flex-[1_0_auto] rounded-[14px] border-0 bg-amber px-7 text-[18px] font-extrabold text-ink hover:bg-[#fbbf24] sm:flex-none"
          >
            Find terminal
          </button>
        </form>
        <p className="m-0 mt-3 text-[14.5px] text-[#c4c9d1]">
          {notFound
            ? `We haven't seen "${notFound}" at Gatwick ${lastDays(days)}. Try the airline's name or your flight number.`
            : "Gatwick's terminals go by airline. This list comes from this week's flights and updates through the day."}
        </p>
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
        <section
          className="flex flex-col gap-[14px] rounded-[24px] border border-line bg-[#f8fafc] p-3 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px] sm:p-6"
          aria-labelledby="list-heading"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-2 pt-2 sm:px-0 sm:pt-0">
            <h2 id="list-heading" className={h2}>
              Airlines at Gatwick {lastDays(days)}
            </h2>
            {airlines.length > 0 && (
              <span className="text-[14.5px] text-muted">
                {north.length} at North · {south.length} at South
              </span>
            )}
          </div>

          {picked && (
            <p className="m-0 rounded-[18px] border border-[#f0a73a] bg-[#fffaf0] px-5 py-4 text-[16px] text-ink">
              <strong>{picked.name}</strong>:{" "}
              {picked.terminal === "BOTH"
                ? "both terminals, depending on the flight."
                : picked.terminal
                  ? `the ${picked.terminal === "NORTH" ? "North" : "South"} Terminal.`
                  : "not published yet, so check your booking."}{" "}
              Based on {picked.flights} {picked.flights === 1 ? "flight" : "flights"} {lastDays(daysCovered(picked.firstDate, now))}.
            </p>
          )}

          {airlines.length ? (
            <div className="overflow-hidden rounded-[20px] border border-line bg-white">
              <div className="hidden grid-cols-[minmax(0,1fr)_170px_150px_100px_100px] gap-3 px-[18px] py-[13px] text-[13.5px] font-bold text-muted md:grid" aria-hidden>
                <span>Airline</span>
                <span>Terminal</span>
                <span>Flights</span>
                <span>{summary?.punctuality ? "On time" : ""}</span>
                <span />
              </div>
              <ul className="m-0 list-none p-0">
                {airlines.map((a) => (
                  <li
                    key={a.slug}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-[#eef0f3] px-[14px] py-3 text-[15.5px] sm:px-[18px] md:grid-cols-[minmax(0,1fr)_170px_150px_100px_100px] ${
                      picked?.slug === a.slug ? "bg-[#fffaf0]" : ""
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-[10px]">
                      <AirlineTag iata={a.codes[0] ?? null} name={a.name} />
                      {a.moved && <span className="text-[13px] font-bold text-[#92400e]">Moved recently</span>}
                    </span>
                    <span className="justify-self-end md:justify-self-start">
                      <TerminalPill t={a.terminal} />
                    </span>
                    <span className="text-[14px] text-muted md:text-[15.5px] md:text-body">
                      {a.flights} {a.flights === 1 ? "flight" : "flights"}
                      {hubOnTime(summary?.punctuality, a.slug) != null && (
                        <span className="md:hidden"> · {hubOnTime(summary?.punctuality, a.slug)}% on time</span>
                      )}
                    </span>
                    <span className="hidden md:block">
                      {summary?.punctuality ? (
                        hubOnTime(summary.punctuality, a.slug) != null ? (
                          <strong className="text-ink">{hubOnTime(summary.punctuality, a.slug)}%</strong>
                        ) : (
                          <span className="text-muted" title={`Fewer than ${summary.punctuality.minFlights} flights in the CAA figures`}>
                            –
                          </span>
                        )
                      ) : null}
                    </span>
                    <span className="justify-self-end md:justify-self-start">
                      {a.hasPage ? (
                        <Link href={`/gatwick/terminals/${a.slug}`} className="font-bold">
                          Details
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="m-0 rounded-[20px] border border-line bg-white px-5 py-5 text-[16.5px]">
              The airline list isn&apos;t available right now. Search for your flight on our{" "}
              <Link href="/flight-status">live Gatwick flight status</Link> page, or check your booking.
            </p>
          )}
          <p className="m-0 px-2 text-[13.5px] text-muted sm:px-0">
            {summary?.updatedAt ? `Updated ${ago(summary.updatedAt, now)}. ` : ""}Counted from the terminals Gatwick published for each
            flight {lastDays(days)}. Terminals can change, so always check your booking.
            {summary?.punctuality
              ? ` On time: arrivals in the CAA figures for the last 12 months ("–" = fewer than ${summary.punctuality.minFlights} flights).`
              : ""}
          </p>
        </section>

        <PunctualityRanking
          scores={summary?.punctuality}
          airlines={airlines}
          direction={searchParams.rank === "departures" ? "DEPARTURE" : "ARRIVAL"}
        />

        <section className="grid gap-4 md:grid-cols-2" aria-label="The two terminals">
          <div className="flex flex-col gap-2 rounded-[22px] border border-line bg-white p-[22px]">
            <h2 className="m-0 font-heading text-[22px] font-bold text-ink">North Terminal</h2>
            <p className="m-0 text-[15.5px]">
              {north.length
                ? `Used by ${north.slice(0, 6).map((a) => a.name).join(", ")}${north.length > 6 ? ` and ${north.length - 6} more` : ""}.`
                : "No airline has used only the North Terminal this week."}
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-[22px] border border-line bg-white p-[22px]">
            <h2 className="m-0 font-heading text-[22px] font-bold text-ink">South Terminal</h2>
            <p className="m-0 text-[15.5px]">
              {south.length
                ? `Used by ${south.slice(0, 6).map((a) => a.name).join(", ")}${south.length > 6 ? ` and ${south.length - 6} more` : ""}.`
                : "No airline has used only the South Terminal this week."}
            </p>
          </div>
        </section>

        <MeetingPoints />
        <BookBand />
        <QuestionList items={faq} />
      </div>
    </>
  );
}
