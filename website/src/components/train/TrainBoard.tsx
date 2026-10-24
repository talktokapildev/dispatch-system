import Link from "next/link";
import { KeepScrollLink } from "@/components/flight/KeepScroll";
import { h2 } from "@/components/flight/ui";
import { ago, ukTime, WEATHER_CREDIT } from "@/lib/flightFormat";
import {
  boardPath,
  boardRows,
  coachesText,
  moved,
  NR_CREDIT,
  otherEnd,
  StationInfo,
  stopFor,
  TrainBoardData,
  trainPath,
  TrainService,
  Way,
} from "@/lib/trainFormat";
import { OperatorTag, PlatformTile, TrainStatus } from "./bits";

const tabClass = (on: boolean) =>
  `inline-flex min-h-[44px] items-center rounded-full px-[18px] text-[15px] no-underline ${
    on ? "bg-white font-extrabold text-ink shadow-[0_1px_2px_rgba(15,23,42,0.12)]" : "font-bold text-body hover:text-ink"
  }`;

// Literal class names (Tailwind only generates classes it can find written out in full).
const COLS = "md:grid-cols-[84px_170px_minmax(0,1fr)_84px_110px_minmax(140px,auto)]";
const FIRST = 14; // rows shown before "Show later trains"

/** Arrivals or departures at one station for the next two hours. */
export default function TrainBoard({ data, way, now, q }: { data: TrainBoardData; way: Way; now: Date; q: string }) {
  const st = data.station;
  const rows = boardRows(data.services, way, now, q);
  const shown = rows.slice(0, FIRST);
  const later = rows.slice(FIRST);
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const list = (items: TrainService[]) => (
    <ul className="m-0 list-none p-0">
      {items.map((s) => (
        <Row key={s.id} s={s} way={way} station={st} />
      ))}
    </ul>
  );

  return (
    <section className="flex flex-col gap-[14px]" aria-labelledby="board-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="board-heading" className={h2}>
          {way === "ARRIVALS" ? `Arriving at ${st.name}` : `Leaving ${st.name}`}
        </h2>
        <nav aria-label="Arrivals or departures" className="flex gap-1 rounded-full bg-[#e2e8f0] p-1">
          <KeepScrollLink href={boardPath(st.slug, "ARRIVALS") + qs} current={way === "ARRIVALS"} className={tabClass(way === "ARRIVALS")}>
            Arrivals
          </KeepScrollLink>
          <KeepScrollLink href={boardPath(st.slug, "DEPARTURES") + qs} current={way === "DEPARTURES"} className={tabClass(way === "DEPARTURES")}>
            Departures
          </KeepScrollLink>
        </nav>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className={`hidden gap-3 px-[18px] py-[13px] text-[13.5px] font-bold text-muted md:grid ${COLS}`} aria-hidden>
          <span>{way === "ARRIVALS" ? "Due" : "Leaves"}</span>
          <span>Train company</span>
          <span>{way === "ARRIVALS" ? "From" : "To"}</span>
          <span>Platform</span>
          <span>Coaches</span>
          <span>Status</span>
        </div>
        {shown.length ? (
          list(shown)
        ) : (
          <p className="m-0 border-t border-[#eef0f3] px-[18px] py-5 text-[15.5px]">
            {q
              ? `No ${way === "ARRIVALS" ? "arrivals from" : "departures to"} "${q}" in the next two hours. `
              : `No more ${way === "ARRIVALS" ? "arrivals" : "departures"} in the next two hours.`}
            {q && <Link href={boardPath(st.slug, way)}>Show all trains</Link>}
          </p>
        )}
        {later.length > 0 && (
          <details className="group border-t border-[#eef0f3]">
            <summary className="flex min-h-[48px] cursor-pointer items-center px-[18px] text-[15px] font-bold text-accent-dark">
              <span className="group-open:hidden">
                Show {later.length} later {later.length === 1 ? "train" : "trains"}
              </span>
              <span className="hidden group-open:inline">Hide later trains</span>
            </summary>
            {list(later)}
          </details>
        )}
      </div>
      <p className="m-0 text-[13.5px] text-muted">
        {data.fetchedAt ? `Updated ${ago(data.fetchedAt, now)}. ` : ""}Times are UK time. Platforms can change at short notice. {NR_CREDIT}.
        {data.weather ? ` ${WEATHER_CREDIT}.` : ""}
      </p>
    </section>
  );
}

function Row({ s, way, station }: { s: TrainService; way: Way; station: StationInfo }) {
  const t = stopFor(s, way)!;
  const end = otherEnd(s, way);
  const isMoved = moved(t) && !s.cancelled;
  const coaches = coachesText(s.coaches);
  return (
    <li className="border-t border-[#eef0f3]">
      <Link
        href={trainPath(station.slug, s.id)}
        className={`grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 px-[14px] py-3 text-[15.5px] text-body no-underline hover:bg-[#f8fafc] hover:text-body sm:px-[18px] md:py-[13px] ${COLS}`}
      >
        <span className="flex flex-col leading-tight">
          <strong className={isMoved ? "text-[13px] font-semibold text-muted line-through" : s.cancelled ? "text-muted line-through" : "text-ink"}>
            {ukTime(t.sched)}
          </strong>
          {isMoved && <strong className="text-ink">{ukTime(t.expected)}</strong>}
        </span>

        {/* Phones: place on top, label + coaches below. From md: separate columns. */}
        <span className="flex min-w-0 flex-col gap-[3px] leading-tight md:contents">
          <span className="order-2 flex items-center gap-[7px] md:order-none md:contents">
            <span className="md:hidden">
              <OperatorTag s={s} size="sm" />
            </span>
            <span className="hidden md:block">
              <OperatorTag s={s} />
            </span>
            {coaches && <span className="whitespace-nowrap text-[13px] text-muted md:hidden">{coaches}</span>}
          </span>
          <span className="order-1 flex min-w-0 flex-col md:order-none">
            <span className="truncate font-bold text-ink">{end.name}</span>
            {end.via && <span className="hidden truncate text-[13.5px] text-muted md:block">{end.via}</span>}
          </span>
          <span className="hidden md:block">
            <PlatformTile platform={s.platform} />
          </span>
          <span className="hidden text-[15px] md:block">{coaches ?? "–"}</span>
        </span>

        <span className="flex flex-col items-end gap-1 justify-self-end md:items-start md:justify-self-start">
          <TrainStatus t={t} cancelled={s.cancelled} />
          {s.platform && <span className="text-[12.5px] font-bold text-ink md:hidden">Platform {s.platform}</span>}
        </span>
      </Link>
    </li>
  );
}
