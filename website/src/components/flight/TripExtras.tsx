import {
  BoardFlight,
  dayLabel,
  FlightForecast,
  FlightView,
  localTime,
  placeName,
  timeDifference,
  ukDate,
  ukTime,
  urlNumber,
  shownNumber,
  Weather,
  WEATHER_CREDIT,
} from "@/lib/flightFormat";
import { WeatherIcon } from "./bits";

// "Your trip" strip under the flight card: forecast at Gatwick and at the destination for the
// moments that matter, the time difference there, and "Add to calendar".

const ENDED = ["LANDED", "DEPARTED", "CANCELLED", "MAYBE_CANCELLED", "DIVERTED"];

function ForecastCard({ w, title, note }: { w: Weather; title: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-[#f8dca6] bg-[#fffaf0] px-4 py-3" title={WEATHER_CREDIT}>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-white">
        <WeatherIcon kind={w.kind} night={w.night} size={24} />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[13.5px] font-bold text-muted">{title}</span>
        <strong className="text-[17px] text-ink">
          {w.tempC}° · {w.text}
        </strong>
        <span className="text-[13.5px] text-muted">{note}</span>
      </span>
    </div>
  );
}

export function calendarHref(f: BoardFlight, number: string): string {
  const dir = f.direction === "ARRIVAL" ? "arrival" : "departure";
  return `/api/flight-status/calendar?number=${encodeURIComponent(urlNumber(number))}&date=${ukDate(f.lgw.scheduledUtc)}&dir=${dir}`;
}

export default function TripExtras({
  f,
  v,
  forecast,
  now,
}: {
  f: BoardFlight;
  v: FlightView;
  forecast: FlightForecast | undefined;
  now: Date;
}) {
  if (ENDED.includes(v.state)) return null;
  const departure = f.direction === "DEPARTURE";
  const place = placeName(f.other);
  const landsAt = departure ? f.other.revisedUtc ?? f.other.scheduledUtc : null;
  const diff = timeDifference(place, f.other.timeZone, (departure ? landsAt : f.other.scheduledUtc) ?? f.lgw.scheduledUtc);
  const landsLocal = localTime(f.other.timeZone, landsAt);
  const cards: { w: Weather; title: string; note: string }[] = [];
  if (forecast?.lgw && forecast.lgwAt)
    cards.push({
      w: forecast.lgw,
      title: departure ? `Gatwick at ${ukTime(forecast.lgwAt)} ${dayLabel(ukDate(forecast.lgwAt)).split(" ")[0]}` : `Gatwick when it lands`,
      note: departure ? "Forecast for when you need to be there" : `Forecast for about ${ukTime(forecast.lgwAt)}`,
    });
  if (forecast?.other && forecast.otherAt)
    cards.push({
      w: forecast.other,
      title: `${place} when you land`,
      note: `Forecast for ${landsLocal ?? ukTime(forecast.otherAt)}${landsLocal ? " local" : ""}`,
    });
  const showCalendar = Date.parse(f.lgw.scheduledUtc) > now.getTime();
  if (!cards.length && !diff && !showCalendar) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="trip-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="trip-heading" className="m-0 font-heading text-[22px] font-bold tracking-[-0.02em] text-ink">
          Your trip
        </h2>
        {showCalendar && (
          <a
            href={calendarHref(f, shownNumber(f))}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-[1.5px] border-[#cbd5e1] bg-white px-4 font-bold text-ink no-underline hover:border-[#94a3b8] hover:text-ink"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4" />
            </svg>
            Add to calendar
          </a>
        )}
      </div>
      {(cards.length > 0 || diff) && (
        <div className="grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
          {cards.map((c) => (
            <ForecastCard key={c.title} {...c} />
          ))}
          {diff && (
            <div className="flex flex-col justify-center rounded-[18px] border border-line bg-white px-4 py-3 leading-tight">
              <span className="text-[13.5px] font-bold text-muted">Time difference</span>
              <strong className="text-[17px] text-ink">{diff}</strong>
              {departure && landsLocal && landsAt && (
                <span className="text-[13.5px] text-muted">
                  Lands {landsLocal} local · {ukTime(landsAt)} UK
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
