import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/flight/AutoRefresh";
import { Fact, h2, StatusPill } from "@/components/flight/ui";
import { OperatorTag, StationBookPanel, TrainStatus } from "@/components/train/bits";
import { ago, ukTime } from "@/lib/flightFormat";
import {
  allStops,
  boardPath,
  coachesText,
  lastPassed,
  moved,
  NR_CREDIT,
  Stop,
  trainIdFromSlug,
  trainPath,
  trainSentence,
  trainStation,
  trainTitle,
} from "@/lib/trainFormat";
import { fetchTrain } from "@/lib/trainTimes";

// Rendered on every request from the backend's cached board. Train IDs change every day, so
// these pages are kept out of Google (the station boards are what people search for).
export const dynamic = "force-dynamic";

type Props = { params: { station: string; id: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const st = trainStation(params.station);
  if (!st) return {};
  const r = await fetchTrain(st.slug, trainIdFromSlug(params.id));
  const title = r.status === "FOUND" ? `${trainTitle(r.service)}: live at ${st.name}` : `Train at ${st.name}`;
  return {
    title,
    robots: { index: false, follow: true },
    alternates: { canonical: trainPath(st.slug, trainIdFromSlug(params.id)) },
  };
}

function stopNote(s: Stop, isLast: boolean): string {
  if (s.cancelled) return "Cancelled";
  if (s.passed) return s.actual ? `${isLast ? "Arrived" : "Left"} ${ukTime(s.actual)}` : isLast ? "Arrived" : "Left";
  if (s.status === "DELAYED") return "Delayed";
  if ((s.status === "LATE" || s.status === "EARLY") && s.expected) return `Exp ${ukTime(s.expected)}`;
  if (s.status === "ON_TIME") return "On time";
  return "";
}

export default async function TrainPage({ params }: Props) {
  const st = trainStation(params.station);
  if (!st) notFound();
  const now = new Date();
  const r = await fetchTrain(st.slug, trainIdFromSlug(params.id));
  const back = (
    <Link href={boardPath(st.slug, "ARRIVALS")} className="font-bold">
      All {st.name} trains
    </Link>
  );

  if (r.status !== "FOUND") {
    return (
      <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-4 py-16">
        <h1 className="m-0 font-heading text-[clamp(30px,4vw,42px)] text-ink">
          {r.status === "ERROR" ? "We can't show this train right now" : "This train isn't on the board any more"}
        </h1>
        <p className="m-0 text-[17px]">
          {r.status === "ERROR"
            ? "Please try again in a minute."
            : `We show trains at ${st.name} for the next two hours, and keep each one for a few hours after it has gone.`}
        </p>
        <p className="m-0 text-[17px]">{back}</p>
      </div>
    );
  }

  const s = r.service;
  const at = s.arr ?? s.dep!;
  const stops = allStops(s, st);
  const lp = lastPassed(stops);
  const markerAfter = !s.cancelled && lp >= 0 && lp < stops.length - 1 ? lp : null;
  const reason = s.cancelled ? s.cancelReason : s.delayReason;

  return (
    <>
      {r.live && <AutoRefresh />}
      <section className="bg-ink text-[#d1d5db]">
        <div className="mx-auto flex max-w-site flex-col gap-3 px-4 pb-[104px] pt-9 sm:px-6 sm:pb-[120px] sm:pt-12">
          <nav aria-label="Breadcrumb" className="text-[14px] text-[#c4c9d1]">
            <Link href={boardPath(st.slug, s.arr ? "ARRIVALS" : "DEPARTURES")} className="text-[#fbbf24] hover:text-[#fde68a]">
              {st.name} trains
            </Link>{" "}
            › {trainTitle(s)}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <OperatorTag s={s} size="lg" />
            <span className="text-[15px]">
              {[coachesText(s.coaches), s.platform ? `Platform ${s.platform}` : null].filter(Boolean).join(" · ")}
            </span>
          </div>
          <h1 className="m-0 font-heading text-[clamp(32px,4.4vw,50px)] font-bold leading-[1.04] tracking-[-0.035em] text-white">
            The {trainTitle(s)}
          </h1>
          <p className="m-0 max-w-[860px] text-[18px] text-[#e5e7eb] sm:text-[19px]">{trainSentence(s, st)}</p>
        </div>
      </section>

      <div className="mx-auto -mt-[72px] grid max-w-site gap-7 px-3 pb-24 sm:-mt-[88px] sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-5 rounded-[26px] border border-line bg-white p-5 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:p-7">
            {!r.live && (
              <p className="m-0 rounded-[14px] bg-[#f1f5f9] px-4 py-3 text-[15.5px]">
                This train has left the live board. This is how it looked {ago(r.fetchedAt, now)}.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {s.arr && (
                <Fact
                  label={`Arrives ${st.name}`}
                  value={moved(s.arr) ? ukTime(s.arr.expected) : ukTime(s.arr.sched)}
                  note={moved(s.arr) ? `Due ${ukTime(s.arr.sched)}` : undefined}
                />
              )}
              {s.dep && (
                <Fact
                  label={`Leaves ${st.name}`}
                  value={moved(s.dep) ? ukTime(s.dep.expected) : ukTime(s.dep.sched)}
                  note={moved(s.dep) ? `Due ${ukTime(s.dep.sched)}` : undefined}
                />
              )}
              <div className="flex flex-col gap-2 rounded-[18px] border border-line bg-white p-4 sm:p-[18px]">
                <span className="text-[13.5px] font-bold text-muted">Status</span>
                <span>
                  <TrainStatus t={at} cancelled={s.cancelled} />
                </span>
              </div>
              <Fact label="Platform" value={s.platform ?? "Not shown yet"} />
              {!(s.arr && s.dep) && <Fact label="Length" value={coachesText(s.coaches) ?? "Not known"} />}
            </div>
            {reason && (
              <p className="m-0 rounded-[14px] border border-[#f8dca6] bg-[#fffaf0] px-4 py-3 text-[15.5px] text-[#78350f]">
                <strong>{s.cancelled ? "Why it's cancelled:" : "Why it's late:"}</strong> {reason}
              </p>
            )}

            <h2 className={h2}>Where the train is</h2>
            <ol className="m-0 flex list-none flex-col p-0">
              {stops.map((x, i) => {
                const passed = i <= lp;
                const isLast = i === stops.length - 1;
                return (
                  <li key={`${x.name}-${i}`} className="contents">
                    <div className="grid min-h-[50px] grid-cols-[54px_26px_minmax(0,1fr)_auto] items-center gap-3">
                      <span className={`text-right font-bold ${passed ? "text-muted" : "text-ink"}`}>{ukTime(x.sched)}</span>
                      <span className="relative flex h-full justify-center" aria-hidden>
                        {!isLast && (
                          <span className={`absolute bottom-[-25px] top-1/2 w-1 rounded ${i < lp ? "bg-[#94a3b8]" : "bg-[#e2e8f0]"}`} />
                        )}
                        <span
                          className={`relative self-center rounded-full ${
                            x.here
                              ? "h-[22px] w-[22px] border-[4px] border-[#fbbf24] bg-ink"
                              : passed
                                ? "h-4 w-4 bg-[#94a3b8]"
                                : "h-4 w-4 border-[3px] border-[#94a3b8] bg-white"
                          }`}
                        />
                      </span>
                      <span className={x.here ? "text-[17px] font-extrabold text-ink" : `font-semibold ${passed ? "text-muted" : "text-ink"}`}>
                        {x.name}
                        {x.cancelled && !x.here ? " (cancelled)" : ""}
                      </span>
                      <span className="text-[14px] text-muted">{stopNote(x, isLast)}</span>
                    </div>
                    {markerAfter === i && (
                      <div className="grid min-h-[44px] grid-cols-[54px_26px_minmax(0,1fr)] items-center gap-3" aria-label="The train is here now">
                        <span />
                        <span className="relative flex h-full justify-center" aria-hidden>
                          <span className="absolute bottom-[-22px] top-[-22px] w-1 rounded bg-[#e2e8f0]" />
                          <span className="relative h-[22px] w-[22px] self-center rounded-full border-[4px] border-[#fde68a] bg-amber" />
                        </span>
                        <span className="font-extrabold text-accent-dark">The train is here</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="m-0 text-[13.5px] text-muted">
              Updated {ago(r.fetchedAt, now)}. Times are UK time. {NR_CREDIT}.
            </p>
          </div>

          {r.messages.length > 0 && (
            <section className="flex flex-col gap-2 rounded-[20px] border-[1.5px] border-[#f3b4b4] bg-[#fdecec] p-4 text-[#7f1d1d] sm:px-5">
              <span className="self-start">
                <StatusPill tone="bad" small>
                  Disruption at {st.name}
                </StatusPill>
              </span>
              {r.messages.map((m) => (
                <p key={m} className="m-0 text-[15px]">
                  {m}
                </p>
              ))}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <StationBookPanel stationName={st.name} compact />
          <p className="m-0 px-2 text-[16px]">{back}</p>
        </aside>
      </div>
    </>
  );
}
