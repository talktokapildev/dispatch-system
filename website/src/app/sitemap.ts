import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const privacyUpdated = new Date("2026-10-14");
  const termsUpdated = new Date("2026-10-14");
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: privacyUpdated, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: termsUpdated, changeFrequency: "yearly", priority: 0.3 },
  ];
}
