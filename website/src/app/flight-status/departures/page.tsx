import type { Metadata } from "next";
import BoardPage from "@/components/flight/BoardPage";
import { pageMetadata } from "@/lib/seo";

// Rendered on every request from the backend's cached board (no provider units).
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata(
  "/flight-status/departures",
  "Gatwick Departures Today: Live Flight Status",
  "Is the flight on time? Live Gatwick departures in plain English: departure time, gate, check-in desks, when to be at the airport and the weather where it's going.",
);

/** Gatwick departures. (A static folder, so it wins over the /flight-status/[flight] pages.) */
export default function DeparturesPage() {
  return <BoardPage direction="DEPARTURE" />;
}
