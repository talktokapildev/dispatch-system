import type { Metadata } from "next";

/** Per-page title, description, canonical URL and Open Graph / Twitter tags. */
export function pageMetadata(path: string, title: string, description: string): Metadata {
  const full = `${title} | OrangeRide`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_GB",
      siteName: "OrangeRide",
      url: path,
      title: full,
      description,
    },
    twitter: { card: "summary", title: full, description },
  };
}
