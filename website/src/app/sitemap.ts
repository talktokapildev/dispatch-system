import type { MetadataRoute } from "next";
import { fetchSitemapLists } from "@/lib/flightStatus";
import { AREAS, areaPath } from "@/lib/areas";
import { SITE_URL } from "@/lib/site";
import { boardPath, TRAIN_STATIONS } from "@/lib/trainFormat";

// Built on each request (Google fetches it now and then): the flight list changes through the day.
// Reading it from the backend is cheap (Redis only) and never costs flight-provider units.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const privacyUpdated = new Date("2026-10-14");
  const termsUpdated = new Date("2026-10-14");
  const now = new Date();
  // Flight pages seen on the Gatwick board in the last 7 days, and airlines with enough flights
  // for their own terminal page (both empty if the backend can't be reached).
  const { numbers: flights, airlines } = await fetchSitemapLists();
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    ...AREAS.map((a) => ({
      url: `${SITE_URL}${areaPath(a.slug)}`,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
    { url: `${SITE_URL}/flight-status`, lastModified: now, changeFrequency: "always", priority: 0.8 },
    { url: `${SITE_URL}/flight-status/departures`, lastModified: now, changeFrequency: "always", priority: 0.8 },
    { url: `${SITE_URL}/gatwick/terminals`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/gatwick/delays`, changeFrequency: "monthly", priority: 0.6 },
    ...airlines.map((slug) => ({
      url: `${SITE_URL}/gatwick/terminals/${encodeURIComponent(slug)}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...TRAIN_STATIONS.flatMap((st) =>
      (["ARRIVALS", "DEPARTURES"] as const).map((way) => ({
        url: `${SITE_URL}${boardPath(st.slug, way)}`,
        lastModified: now,
        changeFrequency: "always" as const,
        priority: 0.7,
      })),
    ),
    { url: `${SITE_URL}/drivers`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, lastModified: privacyUpdated, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: termsUpdated, changeFrequency: "yearly", priority: 0.3 },
    ...flights.map((n) => ({
      url: `${SITE_URL}/flight-status/${encodeURIComponent(n)}`,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];
}
