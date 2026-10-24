import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AutoRefresh from "@/components/flight/AutoRefresh";
import Board from "@/components/flight/Board";
import { boardHref } from "@/components/flight/BoardPage";
import FlightCard from "@/components/flight/FlightCard";
import { BookPanel, GatwickFacts, PlainEnglish, Tips } from "@/components/flight/FlightDetails";
import FlightFaq from "@/components/flight/FlightFaq";
import FlightSearch from "@/components/flight/FlightSearch";
import { breadcrumbs, JsonLd } from "@/components/flight/JsonLd";
import SeenCard, { SeenBookPanel, seenSentence } from "@/components/flight/SeenCard";
import { DarkBand, h2 } from "@/components/flight/ui";
import {
  cleanFlightNumber,
  dayLabel,
  Direction,
  FlightWithView,
  placeName,
  SeenFlight,
  shownNumber,
  terminalName,
  ukDate,
  ukTime,
  urlNumber,
  WEATHER_CREDIT,
} from "@/lib/flightFormat";
import { fetchBoard, fetchFlight, FlightResult } from "@/lib/flightStatus";
import { pageMetadata } from "@/lib/seo";

// Rendered on every request from the backend's cache. Loading this page never spends provider
// units: only the "Check flight" button can.
export const dynamic = "force-dynamic";

type Props = { params: { flight: string }; searchParams: { date?: string; dir?: string; board?: string } };

const validDate = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** What the page is about, from a live flight or one we remember. */
type About = {
  number: string; // as on the ticket, "EZY8687"
  direction: Direction;
  other: string; // "Amsterdam"
  otherIata: string | null;
  terminal: "NORTH" | "SOUTH" | null;
  airline: { name: string | null; iata: string | null };
};

function aboutOf(result: FlightResult, wanted: Direction | null): About | null {
  if (result.status === "FOUND") {
    const f = (result.flights.find((x) => x.flight.direction === wanted) ?? result.flights[0]).flight;
    return {
      number: shownNumber(f),
      direction: f.direction,
      other: placeName(f.other),
      otherIata: f.other.iata,
      terminal: f.lgw.terminal,
      airline: f.airline,
    };
  }
  if (result.status === "SEEN") {
    const s = result.seen.find((x) => x.direction === wanted) ?? result.seen[0];
    return {
      number: s.displayNumber,
      direction: s.direction,
      other: s.other.name ?? s.other.iata ?? "",
      otherIata: s.other.iata,
      terminal: s.terminal,
      airline: s.airline,
    };
  }
  return null;
}

function titleFor(a: About): string {
  const term = terminalName(a.terminal);
  const route = a.direction === "ARRIVAL" ? `${a.other} to Gatwick` : `Gatwick to ${a.other}`;
  return `${a.number} ${route}: Live Status${term ? `, ${term}` : ""}`;
}

function descriptionFor(a: About): string {
  const at = terminalName(a.terminal) ? ` ${terminalName(a.terminal)}` : "";
  return a.direction === "ARRIVAL"
    ? `Is ${a.number} from ${a.other} on time? Live landing time at Gatwick${at}, when passengers will be out of arrivals, and the weather in ${a.other} and at Gatwick.`
    : `Is ${a.number} to ${a.other} on time? Live departure time from Gatwick${at}, gate and check-in, when to be at the airport, and the weather in ${a.other}.`;
}

/** schema.org Flight: the route and, for a live flight, today's times. */
function flightLd(a: About, times?: { departureTime: string | null; arrivalTime: string | null }) {
  const lgw = { "@type": "Airport", iataCode: "LGW", name: "London Gatwick Airport" };
  const other = { "@type": "Airport", ...(a.otherIata ? { iataCode: a.otherIata } : {}), name: a.other };
  return {
    "@context": "https://schema.org",
    "@type": "Flight",
    flightNumber: a.number,
    ...(a.airline.name
      ? { provider: { "@type": "Airline", name: a.airline.name, ...(a.airline.iata ? { iataCode: a.airline.iata } : {}) } }
      : {}),
    departureAirport: a.direction === "ARRIVAL" ? other : lgw,
    arrivalAirport: a.direction === "ARRIVAL" ? lgw : other,
    ...(times?.departureTime ? { departureTime: times.departureTime } : {}),
    ...(times?.arrivalTime ? { arrivalTime: times.arrivalTime } : {}),
  };
}

const wantedDir = (dir: string | undefined): Direction | null =>
  dir === "departure" ? "DEPARTURE" : dir === "arrival" ? "ARRIVAL" : null;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const number = cleanFlightNumber(decodeURIComponent(params.flight));
  if (!number) return { title: "Flight not found", robots: { index: false } };
  const result = await fetchFlight(number, validDate(searchParams.date));
  const a = aboutOf(result, wantedDir(searchParams.dir));
  if (!a)
    // Nothing to show: a page for any typed number would be thin, so keep it out of Google.
    return {
      ...pageMetadata(`/flight-status/${number}`, `${number} flight status at Gatwick`, `Live status for ${number} at London Gatwick.`),
      robots: { index: false },
    };
  // One address per flight: U28687 and EZY8687 both point Google at /flight-status/EZY8687.
  return pageMetadata(`/flight-status/${urlNumber(a.number)}`, titleFor(a), descriptionFor(a));
}

export default async function FlightPage({ params, searchParams }: Props) {
  const raw = decodeURIComponent(params.flight);
  const number = cleanFlightNumber(raw);
  if (!number) notFound();
  const date = validDate(searchParams.date);
  if (raw !== number) redirect(`/flight-status/${number}${date ? `?date=${date}` : ""}`);

  const now = new Date();
  const [result, board] = await Promise.all([fetchFlight(number, date), fetchBoard()]);
  const wanted = wantedDir(searchParams.dir);
  const a = aboutOf(result, wanted);
  const crumbs = (
    <JsonLd
      data={breadcrumbs([
        { name: "Flight status", path: "/flight-status" },
        { name: `${a?.number ?? number}`, path: `/flight-status/${urlNumber(a?.number ?? number)}` },
      ])}
    />
  );

  // ── Not live now, but seen in the last 7 days ──────────────────────────────
  if (result.status === "SEEN" && a) {
    const s: SeenFlight = result.seen.find((x) => x.direction === wanted) ?? result.seen[0];
    const weather = { ...(board?.weather ?? {}), ...(result.weather ?? {}) };
    const hasWeather = !!weather.LGW || (!!s.other.iata && !!weather[s.other.iata]);
    const otherSeen = result.seen.filter((x) => x !== s);
    return (
      <>
        {crumbs}
        <JsonLd data={flightLd(a)} />
        <DarkBand heading={`${number} flight status`} gatwick={weather.LGW}>
          <FlightSearch defaultNumber={number} defaultDate={date ?? undefined} />
        </DarkBand>
        <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-7 px-3 pb-24 sm:-mt-24 sm:px-6">
          <SeenCard s={s} weather={weather} now={now} />
          {otherSeen.map((o) => (
            <p key={o.direction} className="m-0 rounded-[18px] border border-line bg-white px-5 py-4 text-[15.5px]">
              {o.displayNumber} also {o.direction === "ARRIVAL" ? "lands at" : "leaves"} Gatwick, usually around {o.usualTimeUk}.{" "}
              <Link href={`/flight-status/${urlNumber(o.displayNumber)}?dir=${o.direction === "ARRIVAL" ? "arrival" : "departure"}`}>
                Show that flight
              </Link>
            </p>
          ))}
          <div className="flex flex-wrap items-start gap-7">
            <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
              <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-white px-5 py-5 sm:px-[26px] sm:py-6" aria-labelledby="plain">
                <h2 id="plain" className="m-0 font-heading text-[22px] font-bold tracking-[-0.02em] text-ink">
                  In plain English
                </h2>
                <p className="m-0 text-[17px] text-soft">{seenSentence(s)}</p>
              </section>
              {board?.fetchedAt && !board.stale && (
                <Board data={board} direction={s.direction} full={false} now={now} tabHref={boardHref} />
              )}
            </div>
            <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
              <SeenBookPanel s={s} />
            </aside>
          </div>
          <FlightFaq only={s.direction} />
          <p className="m-0 text-[13.5px] text-muted">
            Last seen on our Gatwick board on {dayLabel(s.lastDate)}. Times are UK time. Flight details can change: always
            check with your airline.{hasWeather ? ` ${WEATHER_CREDIT}.` : ""}
          </p>
        </div>
      </>
    );
  }

  // ── Not on the board and not seen recently (or the backend is unreachable) ─
  if (result.status !== "FOUND") {
    return (
      <>
        <DarkBand heading={`${number} flight status`} gatwick={board?.weather?.LGW}>
          <FlightSearch defaultNumber={number} defaultDate={date ?? undefined} />
        </DarkBand>
        <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
          <div className="flex flex-col gap-3 rounded-[24px] border border-line bg-white p-6 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px] sm:p-8">
            <h2 className={h2}>
              {result.status === "ERROR" ? "We can't show flights just now" : `${number} isn't on our live Gatwick board`}
            </h2>
            <p className="m-0 max-w-[720px] text-[17px]">
              {result.status === "ERROR"
                ? "Please try again in a few minutes."
                : `Our live board covers Gatwick flights from the last couple of hours to the next ten or so. ${
                    date ? `For a flight on ${dayLabel(date)}, press "Check flight" above.` : `Choose the date above and press "Check flight".`
                  }`}
            </p>
            <Link href="/flight-status" className="self-start font-bold">
              See all Gatwick arrivals and departures
            </Link>
          </div>
          <FlightFaq />
        </div>
      </>
    );
  }

  // ── Live ───────────────────────────────────────────────────────────────────
  const main: FlightWithView = result.flights.find((x) => x.flight.direction === wanted) ?? result.flights[0];
  const others = result.flights.filter((x) => x !== main);
  const { flight: f, view: v } = main;
  const flightDate = ukDate(f.lgw.scheduledUtc);
  const dirParam = (x: FlightWithView) => (x.flight.direction === "ARRIVAL" ? "arrival" : "departure");
  // Weather: the flight's own reply first, the board's as a fallback (both are the same cache).
  const weather = { ...(board?.weather ?? {}), ...(result.weather ?? {}) };
  const hasWeather = !!weather.LGW || (!!f.other.iata && !!weather[f.other.iata]);
  const boardDir =
    searchParams.board === "departures" ? "DEPARTURE" : searchParams.board === "arrivals" ? "ARRIVAL" : f.direction;
  const arrival = f.direction === "ARRIVAL";
  const ld = flightLd(a!, {
    departureTime: arrival ? f.other.revisedUtc ?? f.other.scheduledUtc : v.expectedAt ?? f.lgw.scheduledUtc,
    arrivalTime: arrival ? v.expectedAt ?? f.lgw.scheduledUtc : f.other.revisedUtc ?? f.other.scheduledUtc,
  });

  return (
    <>
      {crumbs}
      <JsonLd data={ld} />
      <AutoRefresh />
      <DarkBand heading={`${number} flight status`} gatwick={weather.LGW}>
        <FlightSearch defaultNumber={number} defaultDate={flightDate} />
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-7 px-3 pb-24 sm:-mt-24 sm:px-6">
        <FlightCard flight={f} view={v} fetchedAt={result.fetchedAt} now={now} weather={weather} />

        {others.length > 0 && (
          <div className="rounded-[18px] border border-line bg-white px-5 py-4 text-[15.5px]">
            {others.map((o) => (
              <p key={o.flight.id} className="m-0">
                {shownNumber(o.flight)} also {o.flight.direction === "ARRIVAL" ? "lands at" : "leaves"} Gatwick at {ukTime(o.flight.lgw.scheduledUtc)}{" "}
                {o.flight.direction === "ARRIVAL" ? "from" : "to"} {placeName(o.flight.other)}.{" "}
                <Link href={`/flight-status/${number}?date=${ukDate(o.flight.lgw.scheduledUtc)}&dir=${dirParam(o)}`}>
                  Show that flight
                </Link>
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-start gap-7">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-7">
            <GatwickFacts f={f} />
            <PlainEnglish f={f} v={v} now={now} />
            {board?.fetchedAt && !board.stale && (
              <Board
                data={board}
                direction={boardDir}
                full={false}
                now={now}
                highlightId={f.id}
                tabHref={(d) =>
                  `/flight-status/${number}?date=${flightDate}${others.length ? `&dir=${dirParam(main)}` : ""}&board=${
                    d === "DEPARTURE" ? "departures" : "arrivals"
                  }`
                }
              />
            )}
          </div>
          <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
            <BookPanel f={f} v={v} now={now} />
            <Tips f={f} v={v} />
          </aside>
        </div>

        <FlightFaq only={f.direction} />
        <p className="m-0 text-[13.5px] text-muted">
          {urlNumber(shownNumber(f)) !== number ? `Shown as ${shownNumber(f)}. ` : ""}Times are UK time unless marked local. Flight
          details can change: always check with your airline.{hasWeather ? ` ${WEATHER_CREDIT}.` : ""}
        </p>
      </div>
    </>
  );
}
