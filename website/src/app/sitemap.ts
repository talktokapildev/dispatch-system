import type { MetadataRoute } from "next";
import { fetchSitemapNumbers } from "@/lib/flightStatus";
import { SITE_URL } from "@/lib/site";

// Built on each request (Google fetches it now and then): the flight list changes through the day.
// Reading it from the backend is cheap (Redis only) and never costs flight-provider units.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const privacyUpdated = new Date("2026-10-14");
  const termsUpdated = new Date("2026-10-14");
  const now = new Date();
  // Flight pages seen on the Gatwick board in the last 7 days (empty if the backend can't be reached).
  const flights = await fetchSitemapNumbers();
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/flight-status`, lastModified: now, changeFrequency: "always", priority: 0.8 },
    { url: `${SITE_URL}/flight-status/departures`, lastModified: now, changeFrequency: "always", priority: 0.8 },
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
