import Link from "next/link";
import {
  ago,
  BoardData,
  BoardRow,
  Direction,
  placeName,
  shownNumber,
  statusLabel,
  ukDate,
  ukTime,
  urlNumber,
  WEATHER_CREDIT,
  WeatherMap,
} from "@/lib/flightFormat";
import { AirlineTag, Flag, WeatherInline } from "./bits";
import { KeepScrollLink } from "./KeepScroll";
import { StatusPill, h2 } from "./ui";

const tabClass = (on: boolean) =>
  `inline-flex min-h-[44px] items-center rounded-full px-[18px] text-[15px] no-underline ${
    on ? "bg-white font-extrabold text-ink shadow-[0_1px_2px_rgba(15,23,42,0.12)]" : "font-bold text-body hover:text-ink"
  }`;

/**
 * Gatwick arrivals or departures. `full` (the board page): next hour in view, earlier and later
 * flights behind "Show" buttons. Otherwise (a flight page): the next few, and a link to the board.
 * Each row: time, airline label, flight number as on the ticket, flag + city + weather there,
 * terminal, (belt or gate when Gatwick publishes them), status.
 */
export default function Board({
  data,
  direction,
  full,
  now,
  tabHref,
  highlightId,
}: {
  data: BoardData;
  direction: Direction;
  full: boolean;
  now: Date;
  tabHref: (d: Direction) => string;
  highlightId?: string;
}) {
  const rows = direction === "ARRIVAL" ? data.arrivals : data.departures;
  const weather = data.weather ?? {};
  const t = now.getTime();
  const key = (r: BoardRow) => Date.parse(r.view.expectedAt ?? r.view.scheduledAt);
  const done = (r: BoardRow) => r.view.landed || r.view.state === "DEPARTED" || r.view.state === "CANCELLED";
  const earlier = rows.filter((r) => key(r) < t - 30 * 60_000 || (done(r) && key(r) < t));
  const rest = rows.filter((r) => !earlier.includes(r));
  // Full board: everything in the next hour, and never fewer than 8 rows.
  const soon = rest.filter((r) => key(r) <= t + 60 * 60_000);
  const shown = full ? rest.slice(0, Math.max(soon.length, 8)) : rest.slice(0, 6);
  const laterRest = full ? rest.slice(shown.length) : [];
  const showBelt = direction === "ARRIVAL" && rows.some((r) => r.baggageBelt);
  const showGate = direction === "DEPARTURE" && rows.some((r) => r.gate);
  const extra = showBelt ? "Belt" : showGate ? "Gate" : null;
  // Literal class names (Tailwind only generates classes it can find written out in full).
  const cols = full
    ? extra
      ? "md:grid-cols-[84px_150px_104px_minmax(0,1fr)_84px_56px_minmax(140px,auto)]"
      : "md:grid-cols-[84px_150px_104px_minmax(0,1fr)_84px_minmax(140px,auto)]"
    : extra
      ? "md:grid-cols-[84px_112px_104px_minmax(0,1fr)_84px_56px_minmax(140px,auto)]"
      : "md:grid-cols-[84px_112px_104px_minmax(0,1fr)_84px_minmax(140px,auto)]";
  const anyWeather = rows.some((r) => r.other.iata && weather[r.other.iata]);

  const list = (items: BoardRow[]) => (
    <ul className="m-0 list-none p-0">
      {items.map((r) => (
        <Row
          key={r.id}
          r={r}
          direction={direction}
          cols={cols}
          extra={extra}
          highlight={r.id === highlightId}
          weather={weather}
          shortLabel={!full}
        />
      ))}
    </ul>
  );

  return (
    <section className="flex flex-col gap-[14px]" aria-labelledby="board-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="board-heading" className={h2}>
          {full ? `Gatwick ${direction === "ARRIVAL" ? "arrivals" : "departures"} today` : "More flights at Gatwick"}
        </h2>
        <nav aria-label="Arrivals or departures" className="flex gap-1 rounded-full bg-[#e2e8f0] p-1">
          <KeepScrollLink href={tabHref("ARRIVAL")} current={direction === "ARRIVAL"} className={tabClass(direction === "ARRIVAL")}>
            Arrivals
          </KeepScrollLink>
          <KeepScrollLink href={tabHref("DEPARTURE")} current={direction === "DEPARTURE"} className={tabClass(direction === "DEPARTURE")}>
            Departures
          </KeepScrollLink>
        </nav>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className={`hidden gap-3 px-[18px] py-[13px] text-[13.5px] font-bold text-muted md:grid ${cols}`} aria-hidden>
          <span>{direction === "ARRIVAL" ? "Due" : "Leaves"}</span>
          <span>Airline</span>
          <span>Flight</span>
          <span>{direction === "ARRIVAL" ? "From" : "To"}</span>
          <span>Terminal</span>
          {extra && <span>{extra}</span>}
          <span>Status</span>
        </div>
        {full && earlier.length > 0 && (
          <details className="group border-t border-[#eef0f3] md:border-t-0">
            <summary className="flex min-h-[48px] items-center px-[18px] text-[15px] font-bold text-accent-dark">
              <span className="group-open:hidden">Show {earlier.length} earlier {earlier.length === 1 ? "flight" : "flights"}</span>
              <span className="hidden group-open:inline">Hide earlier flights</span>
            </summary>
            {list(earlier)}
          </details>
        )}
        {shown.length ? (
          list(shown)
        ) : (
          <p className="m-0 border-t border-[#eef0f3] px-[18px] py-5 text-[15.5px]">No more {direction === "ARRIVAL" ? "arrivals" : "departures"} in the next few hours.</p>
        )}
        {laterRest.length > 0 && (
          <details className="group border-t border-[#eef0f3]">
            <summary className="flex min-h-[48px] items-center px-[18px] text-[15px] font-bold text-accent-dark">
              <span className="group-open:hidden">Show {laterRest.length} later {laterRest.length === 1 ? "flight" : "flights"}</span>
              <span className="hidden group-open:inline">Hide later flights</span>
            </summary>
            {list(laterRest)}
          </details>
        )}
      </div>
      <p className="m-0 text-[13.5px] text-muted">
        {data.fetchedAt ? `Updated ${ago(data.fetchedAt, now)}. ` : ""}Times are UK time
        {anyWeather ? "; weather is now, at the other airport" : ""}. Flight details can change: always check with your airline.
        {anyWeather ? ` ${WEATHER_CREDIT}.` : ""}
        {!full && (
          <>
            {" "}
            <Link href={direction === "DEPARTURE" ? "/flight-status/departures" : "/flight-status"}>See the full board</Link>
          </>
        )}
      </p>
    </section>
  );
}

function Row({
  r,
  direction,
  cols,
  extra,
  highlight,
  weather,
  shortLabel,
}: {
  r: BoardRow;
  direction: Direction;
  cols: string;
  extra: string | null;
  highlight: boolean;
  weather: WeatherMap;
  shortLabel: boolean;
}) {
  const v = r.view;
  const sched = ukTime(v.scheduledAt);
  const moved = v.expectedAt && v.delayMin != null && Math.abs(v.delayMin) >= 5 && !["CANCELLED", "MAYBE_CANCELLED", "DIVERTED"].includes(v.state);
  const href = `/flight-status/${urlNumber(shownNumber(r))}?date=${ukDate(v.scheduledAt)}`;
  const term = r.terminal === "NORTH" ? "North" : r.terminal === "SOUTH" ? "South" : "–";
  const extraValue = extra === "Belt" ? r.baggageBelt : extra === "Gate" ? r.gate : null;
  const w = r.other.iata ? weather[r.other.iata] : undefined;
  return (
    <li className={`border-t border-[#eef0f3] ${highlight ? "bg-[#fffaf0]" : ""}`}>
      <Link
        href={href}
        className={`grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 px-[14px] py-3 text-[15.5px] text-body no-underline hover:bg-[#f8fafc] hover:text-body sm:px-[18px] md:py-[13px] ${cols}`}
      >
        <span className="flex flex-col leading-tight">
          <strong className={moved ? "text-[13px] font-semibold text-muted line-through" : "text-ink"}>{sched}</strong>
          {moved && <strong className="text-ink">{ukTime(v.expectedAt)}</strong>}
        </span>

        {/* Phones: two lines in the middle column. From md: these become separate columns. */}
        <span className="flex min-w-0 flex-col gap-[3px] leading-tight md:contents">
          <span className="flex items-center gap-[7px] md:contents">
            <span className="md:hidden">
              <AirlineTag iata={r.airlineIata} name={r.airline} size="sm" short />
            </span>
            <span className="hidden md:block">
              <AirlineTag iata={r.airlineIata} name={r.airline} short={shortLabel} />
            </span>
            <span className={`text-ink ${highlight ? "font-extrabold" : "font-bold"}`}>{shownNumber(r)}</span>
          </span>
          {/* The city always keeps its space; on phones weather and terminal wrap below it if needed. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-[7px] gap-y-[2px] text-[14px] md:flex-nowrap md:gap-x-[9px] md:text-[15.5px]">
            <span className="flex min-w-0 max-w-full items-center gap-[7px] md:gap-[9px]">
              <Flag code={r.other.countryCode} />
              <span className="truncate font-semibold text-ink">{placeName(r.other)}</span>
            </span>
            {w && (
              <span className="text-[13.5px] md:text-[14.5px]">
                <WeatherInline w={w} />
              </span>
            )}
            <span className="whitespace-nowrap text-muted md:hidden">
              {term}
              {extraValue ? ` · ${extra} ${extraValue}` : ""}
            </span>
          </span>
          <span className="hidden md:block">{term}</span>
          {extra && <span className="hidden font-semibold text-ink md:block">{extraValue ?? "–"}</span>}
        </span>

        <span className="justify-self-end md:justify-self-start">
          <StatusPill tone={v.tone} small>
            {statusLabel(direction, v, true)}
          </StatusPill>
        </span>
      </Link>
    </li>
  );
}
