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
    boardPath(st.slug, "DEPARTURES"),
    `${st.name} Departures: Live Train Times`,
    `Live departures from ${st.name} station, ${st.town}: platform, number of coaches, delays and cancellations for the next two hours, updated every minute.`,
  );
  return searchParams.q ? { ...meta, robots: { index: false, follow: true } } : meta;
}

export default function StationDeparturesPage({ params, searchParams }: Props) {
  const st = trainStation(params.station);
  if (!st) notFound();
  return <StationPage station={st} way="DEPARTURES" q={(searchParams.q ?? "").slice(0, 40)} />;
}
