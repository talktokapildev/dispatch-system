import {
  ago,
  BoardFlight,
  dayLabel,
  duration,
  FlightView,
  localNow,
  minutesBetween,
  placeName,
  shownNumber,
  statusLabel,
  terminalName,
  TONE,
  ukDate,
  ukTime,
  ukTimeDay,
  dayTag,
  LANDING_NOW_MIN,
  Weather,
  WeatherMap,
} from "@/lib/flightFormat";
import { AirlineTag, Flag, WeatherIcon } from "./bits";
import { PlaneMark, StatusPill } from "./ui";

/** The big card: who/when, the route with progress, the three answers, and the timeline. */
export default function FlightCard({
  flight: f,
  view: v,
  fetchedAt,
  now,
  weather = {},
}: {
  flight: BoardFlight;
  view: FlightView;
  fetchedAt: string;
  now: Date;
  weather?: WeatherMap;
}) {
  const arrival = f.direction === "ARRIVAL";
  const ended = ["CANCELLED", "MAYBE_CANCELLED", "DIVERTED"].includes(v.state);
  const number = shownNumber(f);
  const providerNumber = f.number.replace(/\s/g, "");
  const subtitle = [
    dayLabel(ukDate(f.lgw.scheduledUtc)),
    f.aircraft,
    providerNumber !== number ? `also shown as ${f.number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px]">
      {/* Who and when */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-[#eef0f3] px-[18px] py-[18px] sm:px-8 sm:py-[26px]">
        <div className="flex min-w-0 items-center gap-[14px]">
          <span className="hidden flex-none sm:block">
            <AirlineTag iata={f.airline.iata} name={f.airline.name} size="lg" />
          </span>
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-[10px]">
              <span className="sm:hidden">
                <AirlineTag iata={f.airline.iata} name={f.airline.name} size="sm" />
              </span>
              <strong className="font-heading text-[22px] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[26px]">
                {number}
              </strong>
              <span className="rounded-[6px] bg-ink px-2 py-[2px] text-[12px] font-extrabold tracking-[0.06em] text-[#fbbf24]">
                {arrival ? "ARRIVING" : "DEPARTING"}
              </span>
            </div>
            <span className="text-[14.5px] text-muted sm:text-[15px]">{subtitle}</span>
            {f.codeshare === "CODESHARE" && f.operatedBy && (
              <span className="text-[14px] text-muted">Operated as {f.operatedBy}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusPill tone={v.tone}>{statusLabel(f.direction, v, false, now)}</StatusPill>
          <span className="text-[13.5px] text-muted">Updated {ago(fetchedAt, now)}</span>
        </div>
      </div>

      <Route f={f} v={v} now={now} ended={ended} weather={weather} />
      <Answers f={f} v={v} ended={ended} />
      {!ended && <Timeline f={f} v={v} now={now} />}
    </article>
  );
}

// ── Route + progress ────────────────────────────────────────────────────────
function Route({ f, v, now, ended, weather }: { f: BoardFlight; v: FlightView; now: Date; ended: boolean; weather: WeatherMap }) {
  const arrival = f.direction === "ARRIVAL";
  const otherCode = f.other.iata ?? "···";
  const otherName = placeName(f.other);
  const lgwSub = terminalName(f.lgw.terminal) ?? "Terminal not shown yet";
  const otherLocal = f.other.runwayLocal ?? f.other.revisedLocal ?? f.other.scheduledLocal;

  // Progress 0–1 and the captions under the bar.
  let progress = 0;
  let left = "";
  let right = "";
  const flightMin = arrival
    ? minutesBetween(f.other.scheduledUtc, f.lgw.scheduledUtc)
    : minutesBetween(f.lgw.scheduledUtc, f.other.scheduledUtc);
  if (arrival) {
    if (v.state === "LANDED") {
      progress = 1;
      left = v.takeOffAt ? `Took off ${ukTime(v.takeOffAt)}` : "";
      right = `${v.arrivedTimeIsGate ? "At the gate" : "Landed"} ${ukTime(v.landsAt)}`;
    } else if (v.state === "EN_ROUTE" && v.overdueMin != null) {
      progress = 0.97;
      left = v.overdueMin >= LANDING_NOW_MIN ? "Probably landed · not confirmed yet" : "Landing now";
      right = `Expected ${ukTime(v.landsAt)}`;
    } else if (v.state === "EN_ROUTE") {
      progress = v.progress ?? 0.5;
      const flown = v.takeOffAt ? Math.max(0, Math.round((now.getTime() - Date.parse(v.takeOffAt)) / 60_000)) : null;
      left = flown != null ? `${duration(flown)} flown` : v.inAir === "TRACKED" ? "Probably in the air" : "In the air";
      right = v.minutesToGo != null ? `about ${duration(v.minutesToGo)} to go` : "";
    } else if (v.inAir === "UNCONFIRMED" && !ended) {
      left = v.overdueMin != null ? "Take-off and landing not reported" : "Take-off not confirmed yet";
      right = flightMin && flightMin > 0 ? `Flight time ${duration(flightMin)}` : "";
    } else if (v.departureUnknown && !ended) {
      left = "Departure details not available";
      right = "";
    } else {
      left = ended ? "" : "Not in the air yet";
      right = flightMin && flightMin > 0 ? `Flight time ${duration(flightMin)}` : "";
    }
  } else {
    const landsUtc = f.other.runwayUtc ?? f.other.revisedUtc ?? f.other.scheduledUtc;
    if (v.state === "DEPARTED" && v.departedAt) {
      const total = minutesBetween(v.departedAt, landsUtc);
      const done = Math.round((now.getTime() - Date.parse(v.departedAt)) / 60_000);
      progress = f.other.runwayUtc ? 1 : total && total > 0 ? Math.min(0.97, Math.max(0.03, done / total)) : 0.5;
      left = `Took off ${ukTime(v.departedAt)}`;
      right = landsUtc ? `Lands about ${ukTime(landsUtc)} UK time` : "";
    } else {
      left = ended ? "" : "Still at Gatwick";
      right = flightMin && flightMin > 0 ? `Flight time ${duration(flightMin)}` : "";
    }
  }

  // Take-off in UK time (like the rest of the page), with the local clock there in brackets.
  const otherUtc = f.other.runwayUtc ?? f.other.revisedUtc ?? f.other.scheduledUtc;
  // Arrivals: when it leaves the origin — the take-off if reported, else the expected departure
  // (worked out from the airline's later arrival when the origin's time never moved: "~").
  const depShown = f.other.runwayUtc ?? v.takeOffAt ?? v.departureExpectedAt ?? otherUtc;
  const depGuess = !f.other.runwayUtc && !v.takeOffAt && !!v.departureEstimated;
  const depLocal = depGuess ? null : otherLocal;
  const takeOffText =
    depShown && (depLocal || depGuess)
      ? `${f.other.runwayUtc || v.takeOffAt ? "Took off" : v.state === "EN_ROUTE" || v.landed ? "Left" : "Leaves"} ${depGuess ? "~" : ""}${ukTimeDay(depShown, f.other.scheduledUtc)}${
          depLocal && depLocal !== ukTime(depShown) ? ` (${depLocal} local)` : ""
        }`
      : null;
  const moved = (a: string | null | undefined, b: string | null | undefined) =>
    !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) >= 5 * 60_000;
  // Crossed-out timetable time only for departure times (take-off is always ~10-15 min after
  // leaving the gate, so "Took off 15:52 · was 15:40" would wrongly look late).
  const depWas =
    depShown && !f.other.runwayUtc && !v.takeOffAt && moved(depShown, f.other.scheduledUtc) ? ukTime(f.other.scheduledUtc) : null;
  // Arrivals: the Gatwick gate time on the "To" side, with the timetable time crossed out when it moved.
  const gateText = v.gateAt ? `${v.landed ? "At the gate" : "Gate"} ${v.landed && !v.arrivedTimeIsGate ? "" : "~"}${ukTimeDay(v.gateAt, v.scheduledAt)}` : null;
  const gateWas = moved(v.gateAt, v.scheduledAt) ? ukTime(v.scheduledAt) : null;
  const otherWx = f.other.iata ? weather[f.other.iata] : undefined;
  const lgwWx = weather.LGW;
  const there = localNow(f.other.timeZone, now);
  const otherEnd = {
    code: otherCode,
    name: otherName,
    country: f.other.countryCode ?? null,
    wx: otherWx,
    wxNote: `In ${otherName} now${there ? ` · ${there} local` : ""}`,
  };
  const lgwEnd = { code: "LGW", name: "London Gatwick", country: "GB", wx: lgwWx, wxNote: lgwWx ? `At Gatwick now · wind ${lgwWx.windMph} mph` : "" };
  const leftEnd = arrival
    ? { label: "FROM", ...otherEnd, sub: null, time: takeOffText, was: depWas }
    : { label: "FROM", ...lgwEnd, sub: lgwSub };
  const rightEnd = arrival
    ? { label: "TO", ...lgwEnd, sub: lgwSub, time: ended ? null : gateText, was: ended ? null : gateWas }
    : { label: "TO", ...otherEnd, sub: otherLocal ? `${f.other.runwayLocal ? "Landed" : "Lands"} ${otherLocal} local` : null };

  const pct = `${Math.round(progress * 100)}%`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 px-[18px] py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1fr)] sm:items-center sm:gap-6 sm:px-8 sm:py-[34px]">
      <End {...leftEnd} align="left" />
      <div className="order-3 col-span-2 flex flex-col gap-3 sm:order-none sm:col-span-1">
        <div className="relative h-10" role="img" aria-label={ended ? "Flight not operating" : `Journey ${pct} complete`}>
          <div className="absolute inset-x-0 top-[19px] h-[3px] bg-[repeating-linear-gradient(90deg,#d1d5db_0_8px,transparent_8px_14px)]" />
          {!ended && <div className="absolute left-0 top-[18px] h-[5px] rounded-[3px] bg-amber" style={{ width: pct }} />}
          <span className="absolute left-0 top-[13px] h-[15px] w-[15px] rounded-full bg-amber" />
          <span className="absolute right-0 top-[13px] box-border h-[15px] w-[15px] rounded-full border-[3px] border-[#d1d5db] bg-white" />
          {!ended && (
            <span
              className="absolute top-0 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full bg-ink"
              style={{ left: `clamp(20px, ${pct}, calc(100% - 20px))` }}
            >
              <PlaneMark />
            </span>
          )}
        </div>
        <div className="flex justify-between gap-3 text-[14px] text-muted sm:text-[14.5px]">
          <span>{left}</span>
          <span className="text-right">{right}</span>
        </div>
      </div>
      <End {...rightEnd} align="right" />
    </div>
  );
}

export function End({
  label,
  code,
  name,
  sub,
  time,
  was,
  align,
  country,
  wx,
  wxNote,
}: {
  label: string;
  code: string;
  name: string;
  sub: string | null;
  time?: string | null; // e.g. "Leaves ~22:53" (the new time, like Google's flight card)
  was?: string | null; // the timetable time it replaced, shown crossed out
  align: "left" | "right";
  country: string | null;
  wx?: Weather;
  wxNote: string;
}) {
  const right = align === "right";
  return (
    <div className={`flex min-w-0 flex-col gap-[2px] ${right ? "items-end text-right" : ""}`}>
      <span className="text-[13px] font-extrabold tracking-[0.08em] text-muted">{label}</span>
      <span className={`flex items-center gap-[10px] ${right ? "flex-row-reverse" : ""}`}>
        <strong className="font-heading text-[34px] leading-none tracking-[-0.03em] text-ink sm:text-[44px]">{code}</strong>
        <Flag code={country} size="lg" />
      </span>
      <span className="font-semibold text-soft">{name}</span>
      {time && <span className="text-[14.5px] font-semibold text-ink sm:text-[15px]">{time}</span>}
      {was && (
        <span className="text-[13px] text-soft">
          <span className="sr-only">was </span>
          <s>{was}</s>
        </span>
      )}
      {sub && <span className="text-[14px] text-muted sm:text-[14.5px]">{sub}</span>}
      {wx && (
        <span
          className={`mt-2 inline-flex items-center gap-[10px] rounded-[14px] border py-2 pl-[10px] pr-[14px] text-left ${
            wx.kind === "clear" || wx.kind === "partly" ? "border-[#fde68a] bg-[#fffbeb]" : "border-[#c7d7fe] bg-[#eff4ff]"
          }`}
        >
          <WeatherIcon kind={wx.kind} night={wx.night} size={26} />
          <span className="flex flex-col leading-[1.25]">
            <strong className="text-[15.5px] text-ink sm:text-[17px]">
              {wx.tempC}° · {wx.text}
            </strong>
            <span className="text-[12.5px] text-muted sm:text-[13px]">{wxNote}</span>
          </span>
        </span>
      )}
    </div>
  );
}

// ── The three answers ───────────────────────────────────────────────────────
type Tile = {
  label: string;
  value: string;
  day?: string;
  note: string;
  style: string;
  valueClass?: string;
  labelClass?: string;
  wide?: boolean; // full width on phones (the box that matters most right now)
};

function Answers({ f, v, ended }: { f: BoardFlight; v: FlightView; ended: boolean }) {
  const arrival = f.direction === "ARRIVAL";
  const late = v.delayMin != null && v.delayMin >= 5;
  const early = v.delayMin != null && v.delayMin <= -5;
  // The schedule is the time AT THE GATE (arrivals) / LEAVING THE GATE (departures), as on tickets
  // and airport screens, so say so rather than set it next to a landing time.
  const vsSchedule = (sched: string) => {
    const due = arrival ? `due at the gate ${sched}` : `scheduled ${sched}`;
    // Not seen leaving / no departure details: don't call it "on time" or "early".
    if (arrival && !v.landed && !late && (v.inAir === "UNCONFIRMED" || v.departureUnknown)) return `Due at the gate ${sched}`;
    return late
      ? `${duration(v.delayMin!)} late · ${due}`
      : early
        ? `${duration(-v.delayMin!)} early · ${due}`
        : `On time · ${due}`;
  };

  if (ended) {
    const t = TONE.bad;
    return (
      <div className="px-3 pb-6 sm:px-8 sm:pb-8">
        <div className={`flex flex-col gap-1 rounded-[20px] border-[1.5px] px-[22px] py-5 ${t.soft}`}>
          <span className={`text-[14px] font-bold ${t.text}`}>
            {v.state === "DIVERTED" ? "Diverted" : v.state === "CANCELLED" ? "This flight won't operate" : "Not confirmed by the airline"}
          </span>
          <strong className="font-heading text-[30px] leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
            Was due {ukTime(v.scheduledAt)}
          </strong>
        </div>
      </div>
    );
  }

  const tiles: Tile[] = [];
  const main = TONE[v.tone === "good" ? "early" : v.tone];
  // Arrivals: what matters changes with the stage. Before landing: when it leaves, how long the
  // flight is / how long is left, and when it lands. Once landed: gate and arrivals hall.
  let after: string | null = null; // gate + arrivals hall, in one line, before landing
  if (arrival) {
    const landsTile: Tile = {
      label: v.landed ? (v.arrivedTimeIsGate ? "Arrived" : "Landed") : "Lands",
      value: ukTime(v.landsAt),
      day: dayTag(v.landsAt, v.scheduledAt),
      note: v.landed ? (v.arrivedTimeIsGate ? "Time at the gate" : vsSchedule(ukTime(v.scheduledAt))) : vsSchedule(ukTime(v.scheduledAt)),
      style: main.soft,
      labelClass: main.text,
    };
    const flightMin = minutesBetween(f.other.scheduledUtc, f.lgw.scheduledUtc);
    const flightKnown = flightMin != null && flightMin > 0 && flightMin < 24 * 60;
    const neutral = { style: "bg-[#f8fafc] border-line", labelClass: "text-soft" };

    if (v.landed) {
      tiles.push({ ...landsTile, wide: true });
      tiles.push({
        label: "At the gate",
        value: `${!v.arrivedTimeIsGate ? "" : "~"}${ukTime(v.gateAt)}`,
        day: dayTag(v.gateAt, v.scheduledAt),
        note: v.arrivedTimeIsGate ? "Doors open soon after" : "About 7 min after landing",
        ...neutral,
      });
      tiles.push({
        label: "Out of arrivals",
        value: `~${ukTime(v.outBagsAt)}`,
        day: dayTag(v.outBagsAt, v.scheduledAt),
        note: `With a suitcase · ~${ukTime(v.outHandAt)} hand luggage only`,
        style: TONE.early.soft,
        labelClass: TONE.early.text,
        valueClass: "text-[#2f7d32]",
      });
    } else {
      // When it leaves (or left) the origin.
      const sched = f.other.scheduledUtc;
      const reported = f.other.runwayUtc ?? v.takeOffAt;
      const dep = reported ?? v.departureExpectedAt ?? f.other.revisedUtc ?? sched;
      const guess = !reported && !!v.departureEstimated;
      const inAir = v.state === "EN_ROUTE";
      const depMoved = !reported && dep && sched && Math.abs(Date.parse(dep) - Date.parse(sched)) >= 5 * 60_000;
      const local = !reported && !guess ? f.other.revisedLocal ?? f.other.scheduledLocal : f.other.runwayLocal;
      const localNote = local && dep && local !== ukTime(dep) ? `${local} local` : null;
      if (v.departureUnknown || !dep) {
        tiles.push({ label: "Leaves", value: "Not available", note: "No departure details from the airline yet", ...neutral, valueClass: "text-muted" });
      } else {
        tiles.push({
          label: reported ? "Took off" : inAir ? "Left" : "Leaves",
          value: `${guess ? "~" : ""}${ukTime(dep)}`,
          day: dayTag(dep, sched),
          note: [
            depMoved && sched ? `Was ${ukTime(sched)}` : null,
            guess ? "From the airline's new arrival time" : null,
            !reported && inAir ? "Take-off not reported" : null,
            v.inAir === "UNCONFIRMED" ? "Take-off not confirmed" : null,
            localNote,
          ]
            .filter(Boolean)
            .join(" · ") || (reported ? "Wheels up" : "On schedule"),
          ...neutral,
        });
      }
      // How long the flight is, or how long is left.
      if (inAir && v.overdueMin != null) {
        tiles.push({
          label: "Time left",
          value: v.overdueMin >= LANDING_NOW_MIN ? "Not confirmed" : "Landing now",
          note: `Expected to land ${ukTime(v.landsAt)}`,
          ...neutral,
          valueClass: v.overdueMin >= LANDING_NOW_MIN ? "text-muted" : undefined,
        });
      } else if (inAir && v.minutesToGo != null) {
        tiles.push({
          label: "Time left",
          value: duration(v.minutesToGo),
          note: flightKnown ? `Of a ${duration(flightMin!)} flight` : "Until landing",
          ...neutral,
        });
      } else if (flightKnown) {
        tiles.push({ label: "Flight time", value: duration(flightMin!), note: "Scheduled, gate to gate", ...neutral });
      }
      tiles.push({ ...landsTile, wide: true });
      after = `At the gate ~${ukTimeDay(v.gateAt, v.scheduledAt)} · Out of arrivals ~${ukTime(v.outHandAt)}–${ukTimeDay(v.outBagsAt, v.scheduledAt)} (hand luggage – suitcase)`;
    }
  } else {
    tiles.push({
      label: v.state === "DEPARTED" ? "Took off" : "Departs",
      value: ukTime(v.state === "DEPARTED" ? v.departedAt : v.expectedAt),
      day: dayTag(v.state === "DEPARTED" ? v.departedAt : v.expectedAt, v.scheduledAt),
      note: v.state === "DEPARTED" ? `Scheduled to leave the gate ${ukTime(v.scheduledAt)}` : vsSchedule(ukTime(v.scheduledAt)),
      style: main.soft,
      labelClass: main.text,
    });
    if (v.state !== "DEPARTED") {
      tiles.push(
        f.lgw.gate
          ? { label: "Gate", value: f.lgw.gate, note: "Gates can change: check the screens", style: "bg-[#f8fafc] border-line", labelClass: "text-soft" }
          : {
              label: "Gate",
              value: "Not yet",
              note: `Usually shown about ${ukTime(v.gateShownAt)}`,
              style: "bg-[#f8fafc] border-line",
              labelClass: "text-soft",
              valueClass: "text-muted",
            }
      );
      tiles.push({
        label: "Be at the airport by",
        value: ukTime(v.beThereBy),
        note: `${v.longHaul ? "3 hours" : "2 hours"} before · check your airline`,
        style: TONE.late.soft,
        labelClass: TONE.late.text,
      });
    } else {
      const local = f.other.runwayLocal ?? f.other.revisedLocal ?? f.other.scheduledLocal;
      if (local)
        tiles.push({
          label: `${f.other.runwayLocal ? "Landed" : "Lands"} in ${placeName(f.other)}`,
          value: local,
          note: "Local time there",
          style: "bg-[#f8fafc] border-line",
          labelClass: "text-soft",
        });
    }
  }

  // Departures (and older data): the first box is the main one.
  if (!tiles.some((t) => t.wide) && tiles[0]) tiles[0] = { ...tiles[0], wide: true };
  return (
    <div className="px-3 pb-6 sm:px-8 sm:pb-8">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] sm:gap-[14px]">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`flex flex-col gap-1 rounded-[18px] border-[1.5px] px-4 py-[14px] sm:rounded-[20px] sm:px-[22px] sm:py-5 ${t.style} ${
            t.wide ? "col-span-2 sm:col-span-1" : ""
          }`}
        >
          <span className={`text-[14px] font-bold ${t.labelClass ?? ""}`}>{t.label}</span>
          <strong
            className={`font-heading leading-none tracking-[-0.03em] ${t.wide ? "text-[42px] sm:text-[48px]" : "text-[28px] sm:text-[48px]"} ${
              t.valueClass ?? "text-ink"
            }`}
          >
            {t.value}
            {t.day && <span className="ml-2 text-[16px] font-semibold tracking-normal text-muted sm:text-[20px]">{t.day}</span>}
          </strong>
          <span className="text-[13.5px] text-muted sm:text-[14.5px]">{t.note}</span>
        </div>
      ))}
    </div>
    {after && <p className="m-0 mt-3 px-1 text-[14px] text-muted sm:text-[15px]">{after}</p>}
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
type Step = { title: string; text: string; status: "done" | "now" | "next" };

function Timeline({ f, v, now }: { f: BoardFlight; v: FlightView; now: Date }) {
  const steps: Step[] = [];
  const t = now.getTime();
  if (f.direction === "ARRIVAL") {
    const inAir = v.state === "EN_ROUTE";
    const landing = inAir && v.overdueMin != null; // past the expected touchdown, not confirmed
    const landed = v.landed;
    const atGate = landed && !!v.gateAt && Date.parse(v.gateAt) <= t;
    const out = landed && !!v.outHandAt && Date.parse(v.outHandAt) <= t;
    // Departure time: the airline's latest, with the timetable time if it moved.
    const depDue = f.other.revisedUtc ?? f.other.scheduledUtc;
    const depWas =
      f.other.revisedUtc && f.other.scheduledUtc && ukTime(f.other.revisedUtc) !== ukTime(f.other.scheduledUtc)
        ? ` (was ${ukTime(f.other.scheduledUtc)})`
        : "";
    const unreported = !v.takeOffAt && v.inAir === "TRACKED"; // flying per tracking, take-off never reported
    let takeOffText = "";
    if (v.takeOffAt) takeOffText = ukTime(v.takeOffAt);
    else if (unreported) takeOffText = "Not reported";
    else if (inAir || landed) takeOffText = "Time not reported";
    else if (v.departureEstimated && v.departureExpectedAt)
      takeOffText = `~${ukTimeDay(v.departureExpectedAt, f.other.scheduledUtc)} (was ${ukTime(f.other.scheduledUtc)})`;
    else if (depDue) takeOffText = `Due ${ukTimeDay(depDue, f.other.scheduledUtc)}${depWas}${v.inAir === "UNCONFIRMED" ? " · not confirmed" : ""}`;
    else if (v.departureUnknown) takeOffText = "Not available";
    steps.push({
      title: unreported ? "Take-off" : v.takeOffAt || inAir || landed ? "Took off" : "Takes off",
      text: takeOffText,
      status: v.takeOffAt || inAir || landed ? "done" : "next",
    });
    steps.push({
      title: "In the air",
      text: landing ? "Done" : inAir ? (unreported ? "Probably now" : "Now") : landed ? "Done" : "",
      status: landing ? "done" : inAir ? "now" : landed ? "done" : "next",
    });
    steps.push({
      title: landed ? "Landed" : "Lands",
      text: landing && (v.overdueMin ?? 0) >= LANDING_NOW_MIN ? "Not confirmed" : `${landed ? "" : "~"}${ukTimeDay(v.landsAt, v.scheduledAt)}`,
      status: landed ? (atGate ? "done" : "now") : landing ? "now" : "next",
    });
    steps.push({ title: "At the gate", text: `~${ukTimeDay(v.gateAt, v.scheduledAt)}`, status: atGate ? (out ? "done" : "now") : "next" });
    steps.push({ title: "Arrivals hall", text: `~${ukTime(v.outHandAt)} – ${ukTimeDay(v.outBagsAt, v.scheduledAt)}`, status: out ? "now" : "next" });
  } else {
    const s = v.state;
    const departed = s === "DEPARTED";
    const closed = s === "GATE_CLOSED" || departed;
    const boarding = s === "BOARDING";
    steps.push({
      title: "Check in",
      text: f.lgw.checkInDesk ? `Desks ${f.lgw.checkInDesk}` : "See your airline",
      status: s === "CHECK_IN" ? "now" : boarding || closed || !!f.lgw.gate ? "done" : "next",
    });
    steps.push({
      title: "Gate shown",
      text: f.lgw.gate ? `Gate ${f.lgw.gate}` : `~${ukTime(v.gateShownAt)}`,
      status: f.lgw.gate || boarding || closed ? "done" : "next",
    });
    steps.push({
      title: "Boarding",
      text: boarding ? "Now" : v.boardingAt && !closed ? `~${ukTime(v.boardingAt)}` : "",
      status: boarding ? "now" : closed ? "done" : "next",
    });
    steps.push({ title: "Gate closes", text: s === "GATE_CLOSED" ? "Closed" : "", status: s === "GATE_CLOSED" ? "now" : departed ? "done" : "next" });
    steps.push({
      title: departed ? "Took off" : "Takes off",
      text: ukTimeDay(departed ? v.departedAt : v.expectedAt, v.scheduledAt),
      status: departed ? "done" : "next",
    });
  }

  return (
    <div className="border-t border-[#eef0f3] bg-[#f8fafc] px-[18px] py-5 sm:px-8 sm:py-[26px]">
      <ol className="m-0 grid list-none grid-cols-1 gap-[2px] p-0 sm:grid-cols-5 sm:gap-2">
        {steps.map((st) => (
          <li
            key={st.title}
            className="grid grid-cols-[20px_1fr_auto] items-center gap-3 py-[5px] sm:flex sm:flex-col sm:items-stretch sm:gap-[6px] sm:py-0"
          >
            <span
              aria-hidden
              className={`h-3 w-3 justify-self-center rounded-full sm:h-[6px] sm:w-auto sm:rounded-[3px] ${
                st.status === "done" ? "bg-[#2f7d32]" : st.status === "now" ? "bg-amber" : "bg-[#e5e7eb] max-sm:border-2 max-sm:border-[#d1d5db] max-sm:bg-white"
              }`}
            />
            <strong className={`text-[15px] ${st.status === "next" ? "font-semibold text-soft" : st.status === "now" ? "text-[#92400e]" : "text-ink"}`}>
              {st.title}
              {st.status === "now" && <span className="sr-only"> (now)</span>}
            </strong>
            <span className={`text-[14px] ${st.status === "now" ? "font-semibold text-[#92400e]" : "text-muted"}`}>{st.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
