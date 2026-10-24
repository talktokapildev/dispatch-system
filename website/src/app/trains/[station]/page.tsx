import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StationPage from "@/components/train/StationPage";
import { pageMetadata } from "@/lib/seo";
import { boardPath, trainStation } from "@/lib/trainFormat";

// Rendered on every request from the backend's cached National Rail board.
export const dynamic = "force-dynamic";

type Props = { params: { station: string }; searchParams: { q?: string } };

export function generateMetadata({ params, searchParams }: Props): Metadata {
  const st = trainStation(params.station);
  if (!st) return {};
  const meta = pageMetadata(
    boardPath(st.slug, "ARRIVALS"),
    `${st.name} Train Times: Live Arrivals`,
    `Is the train on time? Live arrivals at ${st.name} station, ${st.town}: expected time, platform, number of coaches, delays and cancellations, updated every minute.`,
  );
  // A search (?q=…) is the same page filtered: keep it out of Google.
  return searchParams.q ? { ...meta, robots: { index: false, follow: true } } : meta;
}

/** A station's arrivals (the main train times page). Departures: /trains/<station>/departures. */
export default function StationArrivalsPage({ params, searchParams }: Props) {
  const st = trainStation(params.station);
  if (!st) notFound();
  return <StationPage station={st} way="ARRIVALS" q={(searchParams.q ?? "").slice(0, 40)} />;
}
