import type { ReactNode } from "react";
import {
  AirlinePunctuality,
  CAA_CREDIT,
  CAA_HREF,
  PunctualityRoute,
  PunctualityStats,
  RoutePunctuality,
} from "@/lib/flightFormat";
import { h2 } from "./ui";

// "How reliable is this route?" (flight pages) and "How punctual is <airline> at Gatwick?"
// (airline terminal pages): UK Civil Aviation Authority monthly punctuality statistics for the
// route and airline over the latest 12 months. The CAA must be credited wherever they're shown.
// Nothing is shown when the backend has no figures (too few flights, or the route isn't matched).

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-09" → "Sep 2025". */
function monthYear(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return `${SHORT[m - 1] ?? ""} ${y}`;
}
export const periodLabel = (from: string, to: string) => `${monthYear(from)} – ${monthYear(to)}`;

/** The seasonal hint's label: "October last year", or "October 2024" if older. */
function monthLabel(p: string, now: Date): string {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS[m - 1] ?? ""} ${y === now.getFullYear() - 1 ? "last year" : y}`;
}

/** 7.1 → "1 in 14"; 0 → "None". */
export function oneIn(pct: number): string {
  if (!pct || pct <= 0) return "None";
  const n = Math.round(100 / pct);
  return n <= 1 ? "Nearly all" : `1 in ${n.toLocaleString("en-GB")}`;
}

const pct1 = (x: number) => `${x.toFixed(1)}%`;
const minutes = (x: number) => `${x} min`;

function Bar({ pct, tone = "ink" }: { pct: number; tone?: "ink" | "low" }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div role="img" aria-label={`${pct} percent on time`} className="h-2 overflow-hidden rounded-full bg-line">
      <div className={`h-2 rounded-full ${tone === "low" ? "bg-accent-dark" : "bg-ink"}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function Tile({ label, short, value, note, children }: { label: string; short: string; value: string; note?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border border-line p-3 sm:gap-2 sm:rounded-[18px] sm:px-[18px] sm:py-4">
      <span className="text-[13px] font-bold text-muted sm:text-[13.5px]">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      <strong className="font-heading text-[20px] leading-[1.1] text-ink sm:text-[34px] sm:leading-none">{value}</strong>
      {children}
      {note && <span className="hidden text-[13.5px] text-muted sm:block">{note}</span>}
    </div>
  );
}

function Credit({ from, to, extra }: { from: string; to: string; extra?: string }) {
  return (
    <p className="m-0 text-[13px] text-muted sm:text-[13.5px]">
      {extra ? `${extra} ` : ""}
      {CAA_CREDIT}, {periodLabel(from, to)}.{" "}
      <a href={CAA_HREF} className="font-semibold" rel="noopener">
        CAA punctuality statistics
      </a>
    </p>
  );
}

/** Flight page card. `airline` and `place` as the page already shows them. */
export function RouteReliability({
  p,
  direction,
  airline,
  place,
  bookAnchor,
  now,
}: {
  p: RoutePunctuality | null | undefined;
  direction: "ARRIVAL" | "DEPARTURE";
  airline: string | null;
  place: string;
  bookAnchor?: string; // arrivals: link to the booking panel on the page
  now: Date;
}) {
  if (!p?.year) return null;
  const arrival = direction === "ARRIVAL";
  const y = p.year;
  const who = airline ? `${airline} flights` : "Flights";
  const route = arrival ? `from ${place} to Gatwick` : `from Gatwick to ${place}`;
  const onTimeLabel = arrival ? "On time" : "Left on time";

  return (
    <section
      className="flex flex-col gap-[14px] rounded-[22px] border border-line bg-white p-5 sm:gap-[18px] sm:p-[26px]"
      aria-labelledby="reliability"
    >
      <div className="flex flex-col gap-[6px]">
        <h2 id="reliability" className="m-0 font-heading text-[24px] font-bold tracking-[-0.02em] text-ink sm:text-[26px]">
          How reliable is this route?
        </h2>
        <p className="m-0 text-[15px] sm:text-[16px]">
          {who} {route}, last 12 months ({periodLabel(p.from, p.to)}) · {y.flights.toLocaleString("en-GB")} flights
        </p>
      </div>

      {/* Phones: "On time" full width, the other three in a row. Wider: four tiles. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="col-span-3 flex flex-col gap-2 rounded-[18px] border border-line p-4 sm:col-span-1 sm:px-[18px]">
          <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-2">
            <span className="text-[13.5px] font-bold text-muted">{onTimeLabel}</span>
            <strong className="font-heading text-[32px] leading-none text-ink sm:text-[34px]">{y.onTimePct}%</strong>
          </div>
          <Bar pct={y.onTimePct} />
          <span className="text-[13.5px] text-muted">Early or up to 15 min late</span>
        </div>
        <Tile label="Average delay" short="Avg delay" value={minutes(y.avgDelayMin)} note={`Early ${arrival ? "arrivals" : "departures"} count as on the dot`} />
        <Tile label="Over an hour late" short="1h+ late" value={oneIn(y.overHourPct)} note={`${pct1(y.overHourPct)} of flights`} />
        <Tile label="Cancelled" short="Cancelled" value={pct1(y.cancelledPct)} note={y.cancelledPct > 0 ? `About ${oneIn(y.cancelledPct)}` : "None in this period"} />
      </div>

      {p.sameMonth && (
        <div className="flex items-center gap-3 rounded-[18px] border border-[#f8dca6] bg-[#fffaf0] px-[14px] py-3 sm:px-4">
          <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white sm:h-10 sm:w-10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18" />
            </svg>
          </span>
          <span className="flex flex-col leading-[1.3]">
            <span className="text-[13px] font-bold text-muted sm:text-[13.5px]">{monthLabel(p.sameMonth.period, now)}</span>
            <strong className="text-[16px] text-ink sm:text-[17px]">
              {p.sameMonth.onTimePct}% on time · average delay {minutes(p.sameMonth.avgDelayMin)}
            </strong>
          </span>
        </div>
      )}

      {arrival && (
        <p className="m-0 text-[15px] text-soft sm:text-[16px]">
          Late landings are why our drivers track every flight and move the pickup to match.
          {bookAnchor && (
            <>
              {" "}
              <a href={bookAnchor} className="font-bold">
                Book a pickup
              </a>
            </>
          )}
        </p>
      )}

      <div className="border-t border-line pt-3 sm:pt-[14px]">
        <Credit from={p.from} to={p.to} extra="Figures are for the route and airline over each month, not this particular flight." />
      </div>
    </section>
  );
}

function DirectionCard({ title, s, onTimeWord }: { title: string; s: PunctualityStats; onTimeWord: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-line bg-white p-5 sm:p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[16px] font-extrabold text-ink">{title}</span>
        <span className="text-[14px] text-muted">{s.flights.toLocaleString("en-GB")} flights</span>
      </div>
      <div className="flex items-baseline gap-[10px]">
        <strong className="font-heading text-[40px] leading-none text-ink">{s.onTimePct}%</strong>
        <span className="text-[15px]">{onTimeWord}</span>
      </div>
      <Bar pct={s.onTimePct} />
      <p className="m-0 text-[15px] text-soft">
        Average delay <strong className="text-ink">{minutes(s.avgDelayMin)}</strong> · over an hour late{" "}
        <strong className="text-ink">{oneIn(s.overHourPct)}</strong> · cancelled <strong className="text-ink">{pct1(s.cancelledPct)}</strong>
      </p>
    </div>
  );
}

function RouteList({ title, routes, low }: { title: string; routes: PunctualityRoute[]; low?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-[22px] border border-line bg-white p-5 sm:p-[22px]">
      <h3 className="m-0 mb-2 font-heading text-[20px] font-bold text-ink">{title}</h3>
      {routes.map((r) => (
        <div
          key={r.iata}
          className="grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-3 gap-y-2 border-t border-line py-[10px] sm:grid-cols-[140px_minmax(0,1fr)_56px_76px]"
        >
          <span className="font-bold text-ink">{r.name}</span>
          <strong className="text-right text-ink sm:order-3">{r.onTimePct}%</strong>
          <div className="col-span-2 sm:order-2 sm:col-span-1">
            <Bar pct={r.onTimePct} tone={low ? "low" : "ink"} />
          </div>
          <span className="hidden text-right text-[14px] text-muted sm:order-4 sm:block">avg {minutes(r.avgDelayMin)}</span>
        </div>
      ))}
    </div>
  );
}

/** Airline terminal page section. */
export function AirlinePunctualitySection({ p, name }: { p: AirlinePunctuality | null | undefined; name: string }) {
  if (!p || (!p.arrivals && !p.departures)) return null;
  return (
    <section className="flex flex-col gap-[14px] sm:gap-[18px]" aria-labelledby="airline-punctuality">
      <div className="flex flex-col gap-[6px]">
        <h2 id="airline-punctuality" className={h2}>
          How punctual is {name} at Gatwick?
        </h2>
        <p className="m-0 text-[16px]">
          All {name} flights in and out of Gatwick, last 12 months ({periodLabel(p.from, p.to)})
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {p.arrivals && <DirectionCard title="Arrivals" s={p.arrivals} onTimeWord="on time" />}
        {p.departures && <DirectionCard title="Departures" s={p.departures} onTimeWord="left on time" />}
      </div>
      {(p.best.length > 0 || p.worst.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {p.best.length > 0 && <RouteList title="Most punctual routes" routes={p.best} />}
          {p.worst.length > 0 && <RouteList title="Least punctual routes" routes={p.worst} low />}
        </div>
      )}
      <Credit
        from={p.from}
        to={p.to}
        extra={`${p.best.length ? "Routes with at least 60 flights in the period, arrivals and departures together. " : ""}On time = early or up to 15 minutes late.`}
      />
    </section>
  );
}
