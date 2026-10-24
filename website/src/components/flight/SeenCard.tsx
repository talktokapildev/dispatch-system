import Link from "next/link";
import { dayLabel, localNow, SeenFlight, terminalName, WeatherMap } from "@/lib/flightFormat";
import { WHATSAPP_HREF } from "@/lib/site";
import { AirlineTag } from "./bits";
import { End } from "./FlightCard";
import { PlaneMark, StatusPill } from "./ui";

// The board covers up to ~10 hours ahead, so a flight's live times appear about then.
const LIVE_HOURS_BEFORE = 10;

function liveFrom(usual: string): { value: string; note: string } {
  const [h, m] = usual.split(":").map(Number);
  const mins = h * 60 + m - LIVE_HOURS_BEFORE * 60;
  if (mins < 0) return { value: "Evening before", note: `About ${LIVE_HOURS_BEFORE} hours before it's due` };
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return { value: `~${hh}:${mm}`, note: "On the day it flies (UK time)" };
}

/** In plain English, for a flight we remember but that isn't in the live window right now. */
export function seenSentence(s: SeenFlight): string {
  const term = terminalName(s.terminal);
  const at = term ? ` ${term}` : "";
  const place = s.other.name ?? s.other.iata ?? "its destination";
  return s.direction === "ARRIVAL"
    ? `${s.displayNumber} from ${place} usually lands at Gatwick${at} around ${s.usualTimeUk} (UK time). It isn't in our live window right now: live times show here about ${LIVE_HOURS_BEFORE} hours before it's due. To check a particular day, choose the date above and press "Check flight".`
    : `${s.displayNumber} to ${place} usually leaves Gatwick${at} around ${s.usualTimeUk} (UK time). It isn't in our live window right now: live times show here about ${LIVE_HOURS_BEFORE} hours before it's due. To check a particular day, choose the date above and press "Check flight".`;
}

/**
 * A flight seen on the board in the last 7 days but not live now: route, usual time and
 * terminal, and when live times will appear. Keeps the page useful (and worth indexing) every day.
 */
export default function SeenCard({ s, weather, now }: { s: SeenFlight; weather: WeatherMap; now: Date }) {
  const arrival = s.direction === "ARRIVAL";
  const term = terminalName(s.terminal);
  const otherName = s.other.name ?? s.other.iata ?? "Unknown";
  const otherWx = s.other.iata ? weather[s.other.iata] : undefined;
  const there = localNow(s.other.timeZone, now);
  const otherEnd = {
    code: s.other.iata ?? "···",
    name: otherName,
    country: s.other.countryCode,
    wx: otherWx,
    wxNote: `In ${otherName} now${there ? ` · ${there} local` : ""}`,
    sub: null,
  };
  const lgwEnd = {
    code: "LGW",
    name: "London Gatwick",
    country: "GB",
    wx: weather.LGW,
    wxNote: weather.LGW ? `At Gatwick now · wind ${weather.LGW.windMph} mph` : "",
    sub: term ?? "Terminal not known",
  };
  const live = liveFrom(s.usualTimeUk);
  const subtitle = [`Last seen ${dayLabel(s.lastDate)}`, s.aircraft].filter(Boolean).join(" · ");

  return (
    <article className="overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-[#eef0f3] px-[18px] py-[18px] sm:px-8 sm:py-[26px]">
        <div className="flex min-w-0 items-center gap-[14px]">
          <span className="hidden flex-none sm:block">
            <AirlineTag iata={s.airline.iata} name={s.airline.name} size="lg" />
          </span>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-[10px]">
              <span className="sm:hidden">
                <AirlineTag iata={s.airline.iata} name={s.airline.name} size="sm" />
              </span>
              <strong className="font-heading text-[22px] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[26px]">
                {s.displayNumber}
              </strong>
              <span className="rounded-[6px] bg-ink px-2 py-[2px] text-[12px] font-extrabold tracking-[0.06em] text-[#fbbf24]">
                {arrival ? "ARRIVING" : "DEPARTING"}
              </span>
            </div>
            <span className="text-[14.5px] text-muted sm:text-[15px]">{subtitle}</span>
          </div>
        </div>
        <StatusPill tone="info">Not live yet</StatusPill>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 px-[18px] py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1fr)] sm:items-center sm:gap-6 sm:px-8 sm:py-[34px]">
        <End label="FROM" align="left" {...(arrival ? otherEnd : lgwEnd)} />
        <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
          <div className="relative h-10" aria-hidden>
            <div className="absolute inset-x-0 top-[19px] h-[3px] bg-[repeating-linear-gradient(90deg,#d1d5db_0_8px,transparent_8px_14px)]" />
            <span className="absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full bg-ink">
              <PlaneMark />
            </span>
            <span className="absolute right-0 top-[13px] box-border h-[15px] w-[15px] rounded-full border-[3px] border-[#d1d5db] bg-white" />
          </div>
        </div>
        <End label="TO" align="right" {...(arrival ? lgwEnd : otherEnd)} />
      </div>

      <div className="grid grid-cols-2 gap-2 px-3 pb-6 sm:grid-cols-3 sm:gap-[14px] sm:px-8 sm:pb-8">
        <div className="col-span-2 flex flex-col gap-1 rounded-[18px] border-[1.5px] border-[#c3d4f7] bg-[#e8effd] px-4 py-[14px] sm:col-span-1 sm:rounded-[20px] sm:px-[22px] sm:py-5">
          <span className="text-[14px] font-bold text-[#1e40af]">{arrival ? "Usually lands" : "Usually leaves"}</span>
          <strong className="font-heading text-[42px] leading-none tracking-[-0.03em] text-ink sm:text-[48px]">{s.usualTimeUk}</strong>
          <span className="text-[13.5px] text-muted sm:text-[14.5px]">Scheduled time, UK</span>
        </div>
        <div className="flex flex-col gap-1 rounded-[18px] border-[1.5px] border-line bg-[#f8fafc] px-4 py-[14px] sm:rounded-[20px] sm:px-[22px] sm:py-5">
          <span className="text-[14px] font-bold text-soft">Terminal</span>
          <strong className="font-heading text-[28px] leading-none tracking-[-0.03em] text-ink sm:text-[48px]">
            {term ? term.replace(" Terminal", "") : "–"}
          </strong>
          <span className="text-[13.5px] text-muted sm:text-[14.5px]">
            {s.terminalInferred ? "Where its airline's flights go: check your booking" : "Check before you set off"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-[18px] border-[1.5px] border-[#f8dca6] bg-[#fffaf0] px-4 py-[14px] sm:rounded-[20px] sm:px-[22px] sm:py-5">
          <span className="text-[14px] font-bold text-[#92400e]">Live times from</span>
          <strong className="font-heading text-[28px] leading-none tracking-[-0.03em] text-ink sm:text-[48px]">{live.value}</strong>
          <span className="text-[13.5px] text-muted sm:text-[14.5px]">{live.note}</span>
        </div>
      </div>
    </article>
  );
}

/** The OrangeRide panel for a remembered flight (no date known, so it offers booking ahead). */
export function SeenBookPanel({ s }: { s: SeenFlight }) {
  const arrival = s.direction === "ARRIVAL";
  const text = [
    arrival ? "Hi OrangeRide, I'd like a pickup from Gatwick:" : "Hi OrangeRide, I'd like a lift to Gatwick:",
    `Flight: ${s.displayNumber} ${arrival ? "from" : "to"} ${s.other.name ?? s.other.iata ?? ""}, date: `,
    arrival ? "Going to: " : "Pickup from: ",
    "Passengers and bags: ",
  ].join("\n");
  return (
    <section className="flex flex-col gap-[14px] rounded-[26px] bg-ink p-[22px] text-[#d1d5db] sm:p-[26px]" aria-labelledby="book">
      <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">
        {arrival ? "PICKING SOMEONE UP?" : "NEED A LIFT TO GATWICK?"}
      </span>
      <h2 id="book" className="m-0 font-heading text-[26px] leading-[1.1] tracking-[-0.02em] text-white sm:text-[28px]">
        {arrival ? `Book a pickup for ${s.displayNumber}.` : `Get to Gatwick for ${s.displayNumber}.`}
      </h2>
      <p className="m-0 text-[16px]">
        {arrival
          ? "Book at least 24 hours ahead. Our driver tracks the flight and moves the pickup if it's late, at a fixed fare."
          : "Book at least 24 hours ahead for a fixed-fare lift to the terminal, timed to your flight."}
      </p>
      <a
        href={`${WHATSAPP_HREF}?text=${encodeURIComponent(text)}`}
        className="flex min-h-[54px] items-center justify-center rounded-[14px] bg-amber px-[18px] py-[14px] text-center text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink"
      >
        Book on WhatsApp
      </a>
      <Link href="/#quote" className="py-2 text-center text-[15px] font-bold text-[#fbbf24] hover:text-[#fde68a]">
        Get a fixed price first
      </Link>
    </section>
  );
}
