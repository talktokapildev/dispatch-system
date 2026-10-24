import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import BoardPage from "@/components/flight/BoardPage";
import { pageMetadata } from "@/lib/seo";

// Rendered on every request from the backend's cached board (no provider units).
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata(
  "/flight-status",
  "Gatwick Arrivals Today: Live Flight Status",
  "Is the flight on time? Live Gatwick arrivals in plain English: when it lands, when passengers will be out of arrivals, terminal, baggage belt and the weather where it's coming from.",
);

/** Gatwick arrivals (the main flight status page). Departures: /flight-status/departures. */
export default function ArrivalsPage({ searchParams }: { searchParams: { dir?: string } }) {
  // The old departures address (?dir=departures) moves permanently to its own page.
  if (searchParams.dir === "departures") permanentRedirect("/flight-status/departures");
  return <BoardPage direction="ARRIVAL" />;
}
