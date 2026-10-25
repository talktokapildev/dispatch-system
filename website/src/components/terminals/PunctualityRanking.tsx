import Link from "next/link";
import { AirlineTag } from "@/components/flight/bits";
import { periodLabel, rankAirlines, RankedAirline } from "@/components/flight/Punctuality";
import { h2 } from "@/components/flight/ui";
import { AirlineScores, AirlineTerminal, CAA_CREDIT } from "@/lib/flightFormat";

// "Most punctual airlines at Gatwick" on /gatwick/terminals: CAA figures for the latest 12 months,
// airlines with at least `minFlights` flights in that direction. Arrivals / Departures are plain
// links (?rank=departures), so the page works without JavaScript; the rest of the list opens in a
// <details> (the button goes once it's open).

const SHOWN = 6;
const COLS = "grid-cols-[28px_minmax(0,1fr)_52px] sm:grid-cols-[36px_200px_minmax(0,1fr)_64px_96px_96px]";

function Row({ r, i }: { r: RankedAirline; i: number }) {
  const name = <AirlineTag iata={r.iata} name={r.name} />;
  return (
    <li className={`grid ${COLS} items-center gap-x-3 gap-y-2 border-t border-[#eef0f3] px-[14px] py-3 text-[15.5px] sm:gap-x-[14px] sm:px-5`}>
      <span className="font-extrabold text-muted">{i + 1}</span>
      <span className="min-w-0">
        {r.hasPage ? (
          <Link href={`/gatwick/terminals/${r.slug}`} className="no-underline" aria-label={`${r.name} at Gatwick`}>
            {name}
          </Link>
        ) : (
          name
        )}
      </span>
      <strong className="text-right text-ink sm:order-4">{r.s.onTimePct}%</strong>
      <div
        role="img"
        aria-label={`${r.s.onTimePct} percent on time`}
        className="col-span-3 col-start-1 h-2 overflow-hidden rounded-full bg-line sm:order-3 sm:col-span-1 sm:col-start-auto"
      >
        <div className="h-2 rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, r.s.onTimePct))}%` }} />
      </div>
      <span className="hidden text-right sm:order-5 sm:block">{r.s.avgDelayMin} min</span>
      <span className="hidden text-right text-muted sm:order-6 sm:block">{r.s.flights.toLocaleString("en-GB")}</span>
    </li>
  );
}

export default function PunctualityRanking({
  scores,
  airlines,
  direction,
}: {
  scores: AirlineScores | null | undefined;
  airlines: AirlineTerminal[];
  direction: "ARRIVAL" | "DEPARTURE";
}) {
  const ranked = rankAirlines(scores, airlines, direction);
  if (!scores || ranked.length < 3) return null;
  const arrival = direction === "ARRIVAL";
  const tab = (label: string, active: boolean, href: string) => (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-[40px] items-center rounded-full px-[18px] font-bold no-underline ${
        active ? "bg-white text-ink shadow-sm" : "text-body hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <section id="most-punctual" className="flex flex-col gap-[14px] sm:gap-4" aria-labelledby="punctual-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="punctual-heading" className={h2}>
          Most punctual airlines at Gatwick
        </h2>
        <div role="group" aria-label="Arrivals or departures" className="inline-flex gap-1 rounded-full bg-[#e2e8f0] p-1">
          {tab("Arrivals", arrival, "/gatwick/terminals#most-punctual")}
          {tab("Departures", !arrival, "/gatwick/terminals?rank=departures#most-punctual")}
        </div>
      </div>
      <p className="m-0 text-[16px]">
        Share of {arrival ? "arrivals that landed" : "departures that left"} early or up to 15 minutes late,{" "}
        {periodLabel(scores.from, scores.to)}. Airlines with at least {scores.minFlights} {arrival ? "arrivals" : "departures"}.
      </p>
      <div className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className={`hidden ${COLS} gap-x-[14px] px-5 py-[13px] text-[13.5px] font-bold text-muted sm:grid`} aria-hidden>
          <span>#</span>
          <span>Airline</span>
          <span />
          <span className="text-right">On time</span>
          <span className="text-right">Avg delay</span>
          <span className="text-right">Flights</span>
        </div>
        <ol className="m-0 list-none p-0">
          {ranked.slice(0, SHOWN).map((r, i) => (
            <Row key={r.slug} r={r} i={i} />
          ))}
        </ol>
        {ranked.length > SHOWN && (
          <details className="group border-t border-[#eef0f3]">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-center px-5 font-bold text-ink group-open:hidden [&::-webkit-details-marker]:hidden">
              <span className="rounded-full border-[1.5px] border-[#cbd5e1] px-[18px] py-2">Show all {ranked.length} airlines</span>
            </summary>
            <ol className="m-0 list-none p-0" start={SHOWN + 1}>
              {ranked.slice(SHOWN).map((r, i) => (
                <Row key={r.slug} r={r} i={i + SHOWN} />
              ))}
            </ol>
          </details>
        )}
      </div>
      <p className="m-0 text-[13.5px] text-muted">
        {CAA_CREDIT}, {periodLabel(scores.from, scores.to)}. Each airline over all its Gatwick routes.{" "}
        <Link href="/gatwick/delays" className="font-semibold">
          How punctual is Gatwick overall?
        </Link>
      </p>
    </section>
  );
}
