import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AutoRefresh from "@/components/flight/AutoRefresh";
import Board from "@/components/flight/Board";
import FlightCard from "@/components/flight/FlightCard";
import { BookPanel, GatwickFacts, PlainEnglish, Tips } from "@/components/flight/FlightDetails";
import FlightFaq from "@/components/flight/FlightFaq";
import FlightSearch from "@/components/flight/FlightSearch";
import { DarkBand, h2 } from "@/components/flight/ui";
import { cleanFlightNumber, dayLabel, FlightWithView, placeName, ukDate, ukTime, urlNumber } from "@/lib/flightFormat";
import { fetchBoard, fetchFlight } from "@/lib/flightStatus";
import { pageMetadata } from "@/lib/seo";

// Rendered on every request from the backend's cache. Loading this page never spends provider
// units: only the "Check flight" button can.
export const dynamic = "force-dynamic";

type Props = { params: { flight: string }; searchParams: { date?: string; dir?: string; board?: string } };

const validDate = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const number = cleanFlightNumber(decodeURIComponent(params.flight));
  if (!number) return { title: "Flight not found", robots: { index: false } };
  const result = await fetchFlight(number, validDate(searchParams.date));
  const base = pageMetadata(
    `/flight-status/${number}`,
    `${number} flight status at Gatwick`,
    `Is ${number} on time? Live status at London Gatwick in plain English: landing or departure time, terminal, gate and baggage belt.`,
  );
  // Only index flights we can actually show; a page for any typed number would be thin.
  return result.status === "FOUND" ? base : { ...base, robots: { index: false } };
}

export default async function FlightPage({ params, searchParams }: Props) {
  const raw = decodeURIComponent(params.flight);
  const number = cleanFlightNumber(raw);
  if (!number) notFound();
  const date = validDate(searchParams.date);
  if (raw !== number) redirect(`/flight-status/${number}${date ? `?date=${date}` : ""}`);

  const now = new Date();
  const [result, board] = await Promise.all([fetchFlight(number, date), fetchBoard()]);

  if (result.status !== "FOUND") {
    return (
      <>
        <DarkBand heading={`${number} flight status`}>
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

  // A flight number can pass through Gatwick twice in a day (arrives, then leaves again).
  const wanted = searchParams.dir === "departure" ? "DEPARTURE" : searchParams.dir === "arrival" ? "ARRIVAL" : null;
  const main: FlightWithView = result.flights.find((x) => x.flight.direction === wanted) ?? result.flights[0];
  const others = result.flights.filter((x) => x !== main);
  const { flight: f, view: v } = main;
  const flightDate = ukDate(f.lgw.scheduledUtc);
  const dirParam = (x: FlightWithView) => (x.flight.direction === "ARRIVAL" ? "arrival" : "departure");
  const boardDir =
    searchParams.board === "departures" ? "DEPARTURE" : searchParams.board === "arrivals" ? "ARRIVAL" : f.direction;

  return (
    <>
      <AutoRefresh />
      <DarkBand heading={`${number} flight status`}>
        <FlightSearch defaultNumber={number} defaultDate={flightDate} />
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-7 px-3 pb-24 sm:-mt-24 sm:px-6">
        <FlightCard flight={f} view={v} fetchedAt={result.fetchedAt} now={now} />

        {others.length > 0 && (
          <div className="rounded-[18px] border border-line bg-white px-5 py-4 text-[15.5px]">
            {others.map((o) => (
              <p key={o.flight.id} className="m-0">
                {o.flight.number} also {o.flight.direction === "ARRIVAL" ? "lands at" : "leaves"} Gatwick at {ukTime(o.flight.lgw.scheduledUtc)}{" "}
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
          {urlNumber(f.number) !== number ? `Shown as ${f.number}. ` : ""}Times are UK time unless marked local. Flight details can
          change: always check with your airline.
        </p>
      </div>
    </>
  );
}
