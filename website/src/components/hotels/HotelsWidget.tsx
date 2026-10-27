"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { GATWICK_PLACE_ID, HOTELS_DOMAIN } from "@/lib/site";

// LiteAPI "Hotels List" widget: hotels around Gatwick with live prices for the chosen dates.
// Choosing a hotel opens our white-label booking site (HOTELS_DOMAIN), where Nuitée takes the
// payment. Docs: https://docs.liteapi.travel/docs/integrate-a-hotels-list-widget
//
// If the widget script can't load (blocked, offline, LiteAPI down), the visitor still gets a
// plain link to the same search on the booking site.

const SDK = "https://components.liteapi.travel/v1.0/sdk.umd.js";
const CONTAINER_ID = "gatwick-hotels-list";
const NAME = "London Gatwick Airport (LGW)";

type LiteApi = {
  init: (o: { domain: string }) => void;
  HotelsList: { create: (o: Record<string, unknown>) => void };
};
declare global {
  interface Window {
    LiteAPI?: LiteApi;
  }
}

/** YYYY-MM-DD in UK time, `days` from today. */
function ukDay(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

/** The same Gatwick search as a plain link (fallback, and the sort/filter links).
 *  sorting: the booking site's own sort, "2" = price, low to high (default: its top picks). */
export function hotelsSearchHref({ checkin = ukDay(1), checkout = ukDay(2), sorting }: { checkin?: string; checkout?: string; sorting?: "2" } = {}): string {
  const occupancies = btoa(JSON.stringify([{ adults: 2, children: [] }]));
  const q = new URLSearchParams({
    placeId: GATWICK_PLACE_ID,
    name: NAME,
    checkin,
    checkout,
    rooms: "1",
    adults: "2",
    occupancies,
    utm_source: "orangeride",
    utm_medium: "gatwick-hotels",
  });
  if (sorting) q.set("sorting", sorting);
  return `https://${HOTELS_DOMAIN}/hotels?${q.toString()}`;
}

// The list widget has no sort or filter options of its own, so these open the same search on the
// booking site, which has them (price, rating, distance, free cancellation, breakfast…).
const pill =
  "inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-[#cbd5e1] bg-white px-4 text-[15px] font-bold text-ink no-underline hover:border-[#94a3b8] hover:text-ink";

export default function HotelsWidget() {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const created = useRef(false);

  const create = () => {
    const api = window.LiteAPI;
    if (!api || created.current) return;
    try {
      api.init({ domain: HOTELS_DOMAIN });
      api.HotelsList.create({
        selector: `#${CONTAINER_ID}`,
        placeId: GATWICK_PLACE_ID,
        primaryColor: "#B45309",
        hasSearchBar: true,
        rows: 2,
        currency: "GBP",
        checkin: ukDay(1),
        checkout: ukDay(2),
        deepLinkParams: "utm_source=orangeride&utm_medium=gatwick-hotels",
        labelsOverride: { searchAction: "Search", placePlaceholderText: "Gatwick, Crawley, Horley…" },
      });
      created.current = true;
      setState("ready");
    } catch {
      setState("failed");
    }
  };

  // Script already on the page (client-side navigation back to this page).
  useEffect(() => {
    if (window.LiteAPI) create();
    const t = window.setTimeout(() => !created.current && setState("failed"), 15_000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {state !== "failed" && (
        <div className="flex flex-wrap items-center gap-2 px-2 sm:px-0">
          <span className="text-[15px] font-bold text-soft">Sort and filter:</span>
          <a href={hotelsSearchHref({ sorting: "2" })} className={pill}>
            Cheapest first
          </a>
          <a href={hotelsSearchHref()} className={pill}>
            All hotels and filters
          </a>
        </div>
      )}
      <Script src={SDK} strategy="afterInteractive" onLoad={create} onError={() => setState("failed")} />
      <div id={CONTAINER_ID} className={state === "failed" ? "hidden" : "min-h-[420px]"} aria-busy={state === "loading"} />
      {state === "loading" && <p className="m-0 text-center text-[15px] text-muted">Loading hotels and prices…</p>}
      {state === "failed" && (
        <div className="flex flex-col items-start gap-3 rounded-[18px] border border-line bg-white p-5">
          <p className="m-0 text-[16px] text-soft">The hotel list couldn&apos;t load here. You can still search and book on our hotel site.</p>
          <a
            href={hotelsSearchHref()}
            className="inline-flex min-h-[48px] items-center rounded-[14px] bg-amber px-5 font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink"
          >
            Search hotels near Gatwick
          </a>
        </div>
      )}
    </div>
  );
}
