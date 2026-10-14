# OrangeRide website (orangeride.co.uk)

The public marketing site: home page, Privacy Policy, Terms & Conditions and a 404 page.
Next.js 14.2 (App Router), React 18, Tailwind 3.4, TypeScript. Static pages, no forms, no backend calls.

The approved design is the Claude Design canvas (artboards `Light-v4`, `Privacy`, `Terms`). The layout,
colours and copy follow it exactly; the legal wording is word for word.

## Run locally

```bash
cd website
npm install
npm run dev          # http://localhost:3100
```

## Build and check

```bash
npm run build        # production build (fetches Figtree + Familjen Grotesk from Google Fonts at build time)
npm run start        # serve the build on :3000 (or -p <port>)
npm run lint
npx tsc --noEmit
```

## Deploy (Railway)

New service in the OrangeRide Railway project, **root directory `website/`**. `railway.toml` uses Nixpacks,
starts with `next start -p $PORT` and health-checks `/`. No environment variables are needed.
Every push to `master` that touches `website/` redeploys it.

## Where things are

| Path | What |
|---|---|
| `src/lib/site.ts` | Phone, WhatsApp, email, app-store links, TfL licence, operating centre. Change contact details here only. |
| `src/app/layout.tsx` | Fonts, default metadata (title, Open Graph, Twitter), JSON-LD, shared strip/header/footer |
| `src/app/page.tsx` | Home page: the list of sections, in order |
| `src/components/home/*` | One file per home section: Hero (+ HeroPhone), TrustRow, Arrivals, WhyOrangeRide, HowToBook, Gatwick, DriveWithUs, Faq, FinalCta |
| `src/components/legal/LegalLayout.tsx` | Shared layout for the legal pages |
| `src/content/privacy.tsx`, `terms.tsx` | Legal text. Update "Last updated" when the wording changes. |
| `src/app/sitemap.ts`, `robots.ts` | `/sitemap.xml`, `/robots.txt` |
| `src/app/icon.png`, `apple-icon.png` | Favicon and iOS icon (made from the pin logo) |
| `src/app/opengraph-image.tsx` | 1200x630 share image (fonts in `src/assets/og/`, SIL OFL) |
| `next.config.js` | Permanent redirects from the old WordPress URLs |

**Adding interactive features later** (fare checker, flight lookup, quotes): each home section is a
self-contained component with its own anchor id. Build the new component (with `"use client"` if it needs
state) and swap it into `src/app/page.tsx`, or replace the static example inside the section
(e.g. `ExampleFlightCard` in `Arrivals.tsx`, the fare illustration in `HowToBook.tsx`).

## Redirects from the old WordPress site

| Old | New |
|---|---|
| `/privacy-policy/` | `/privacy` (registered in App Store Connect / Google Play Console) |
| `/hello-world/`, `/category/…`, `/2026/…`, `/author/…`, `/feed/`, `/comments/feed/` | `/` |
| `/wp-sitemap.xml`, `/wp-sitemap-*.xml`, `/sitemap_index.xml` | `/sitemap.xml` |
| `/wp-admin/…`, `/wp-login.php` | `/` |

`www.orangeride.co.uk/*` also redirects to `orangeride.co.uk/*` (the apex is the canonical address).

All are permanent. URLs with a trailing slash take two 308 hops (Next.js strips the slash first).

## Notes

- Only the TfL operating centre address appears on the site. Don't add a home address anywhere.
- A few text colours are slightly darker than the canvas where the original failed WCAG AA contrast
  (amber text on light amber, grey timestamps on the dark cards, small green and grey labels).
