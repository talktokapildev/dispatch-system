import AutoRefresh from "@/components/flight/AutoRefresh";
import { breadcrumbs, JsonLd } from "@/components/flight/JsonLd";
import { KeepScrollRestore } from "@/components/flight/KeepScroll";
import { DarkBand, h2 } from "@/components/flight/ui";
import { SITE_URL } from "@/lib/site";
import { boardPath, disruptionCounts, nationalRailBoard, StationInfo, Way } from "@/lib/trainFormat";
import { fetchTrainBoard } from "@/lib/trainTimes";
import { StationBookPanel } from "./bits";
import TrainBoard from "./TrainBoard";

/**
 * A station's live board: /trains/<slug> (arrivals) and /trains/<slug>/departures. Read from
 * the backend's cached National Rail board (refreshed every minute); never calls National Rail.
 * `q` (from the search box) keeps only trains from / to / calling at a matching place.
 */
export default async function StationPage({ station, way, q }: { station: StationInfo; way: Way; q: string }) {
  const now = new Date();
  const board = await fetchTrainBoard(station.slug);
  const available = !!board?.fetchedAt && !board.stale;
  const counts = available ? disruptionCounts(board!.services, now) : { cancelled: 0, late: 0 };
  const trail = [{ name: `${station.name} trains`, path: boardPath(station.slug, "ARRIVALS") }];
  if (way === "DEPARTURES") trail.push({ name: "Departures", path: boardPath(station.slug, "DEPARTURES") });

  return (
    <>
      <JsonLd data={breadcrumbs(trail)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "TrainStation",
          name: `${station.name} station`,
          url: `${SITE_URL}${boardPath(station.slug, "ARRIVALS")}`,
          address: { "@type": "PostalAddress", addressLocality: station.town, addressCountry: "GB" },
        }}
      />
      <KeepScrollRestore />
      <AutoRefresh />
      <DarkBand
        heading="Is the train on time?"
        gatwick={board?.weather ?? undefined}
        eyebrow={`LIVE TRAIN TIMES · ${station.name.toUpperCase()} STATION, ${station.town.toUpperCase()}`}
        weatherLabel={`${station.name} now`}
      >
        <form action={boardPath(station.slug, way)} method="get" className="flex flex-col gap-[10px] sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-[6px] text-[13px] font-bold text-[#c4c9d1]">
            {way === "ARRIVALS" ? "Coming from" : "Going to"}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="e.g. London Victoria, Brighton, Gatwick Airport"
              maxLength={40}
              className="h-[56px] rounded-[14px] border-0 bg-white px-[18px] text-[18px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="h-[56px] rounded-[14px] bg-amber px-7 text-[18px] font-extrabold text-ink hover:bg-[#fbbf24]"
          >
            Show trains
          </button>
        </form>
        <p className="m-0 mt-3 text-[14.5px] text-[#c4c9d1]">
          Every train at {station.name} in the next two hours, updated every minute from National Rail.
        </p>
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-8 px-3 pb-24 sm:-mt-24 sm:px-6">
        {available && (board!.messages.length > 0 || counts.cancelled > 0) && (
          <section className="flex gap-[14px] rounded-[20px] border-[1.5px] border-[#f3b4b4] bg-[#fdecec] p-4 sm:px-5" aria-label="Disruption">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#b91c1c] font-extrabold text-white" aria-hidden>
              !
            </span>
            <div className="flex min-w-0 flex-col gap-2 text-[#7f1d1d]">
              {(counts.cancelled > 0 || counts.late > 0) && (
                <strong className="text-[17px]">
                  {[
                    counts.cancelled ? `${counts.cancelled} ${counts.cancelled === 1 ? "train" : "trains"} cancelled` : "",
                    counts.late ? `${counts.late} running late` : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  at {station.name} in the next two hours
                </strong>
              )}
              {board!.messages.map((m) => (
                <p key={m} className="m-0 text-[15px]">
                  {m}
                </p>
              ))}
            </div>
          </section>
        )}

        <div className="rounded-[24px] border border-line bg-[#f8fafc] p-3 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px] sm:p-6">
          {available ? (
            <TrainBoard data={board!} way={way} now={now} q={q} />
          ) : (
            <div className="flex flex-col gap-2 px-2 py-4">
              <h2 className={h2}>Live train times aren&apos;t available right now</h2>
              <p className="m-0 text-[16.5px]">
                Please check{" "}
                <a href={nationalRailBoard(station.crs)} rel="nofollow">
                  National Rail&apos;s live board for {station.name}
                </a>
                .
              </p>
            </div>
          )}
        </div>

        <StationBookPanel stationName={station.name} />
      </div>
    </>
  );
}
