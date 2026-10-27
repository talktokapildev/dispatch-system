import type { Metadata } from "next";
import Link from "next/link";
import { breadcrumbs, JsonLd } from "@/components/flight/JsonLd";
import { DarkBand, h2 } from "@/components/flight/ui";
import HotelsWidget from "@/components/hotels/HotelsWidget";
import { pageMetadata } from "@/lib/seo";
import { HOTELS_DOMAIN, HOTELS_LIVE } from "@/lib/site";

// "Hotels near Gatwick": LiteAPI's hotel list widget (live prices), booking on our white-label hotel
// site, where Nuitée is the merchant of record and looks after the stay. Our transfers are a
// separate purchase. Hidden from Google, the sitemap and menus until HOTELS_LIVE.

const meta = pageMetadata(
  "/gatwick/hotels",
  "Hotels near Gatwick Airport",
  "Compare and book hotels near Gatwick Airport, Crawley and Horley, with live prices for your dates. Handy before an early flight or after a late landing.",
);
export const metadata: Metadata = HOTELS_LIVE ? meta : { ...meta, robots: { index: false, follow: false } };

const FAQ: { q: string; a: string }[] = [
  {
    q: "Who do I book with?",
    a: `Hotel bookings are made on ${HOTELS_DOMAIN}, run with our travel partner Nuitée. Nuitée takes the payment, sends your confirmation and looks after any changes or problems with your stay. Their support details are in your confirmation email.`,
  },
  {
    q: "Is the price final?",
    a: "The price shown includes the taxes and fees the hotel charges through the booking. A few hotels add a local charge you pay at the hotel; if so, it's shown before you pay.",
  },
  {
    q: "Can I cancel?",
    a: "It depends on the rate. Each room shows whether it's free to cancel and until when, before you book. Non-refundable rates are usually cheaper.",
  },
  {
    q: "Do you include a transfer?",
    a: "No. The hotel and our private hire transfers are booked separately. If you need a car to or from Gatwick, get a fixed price on our home page.",
  },
];

export default function HotelsPage() {
  return (
    <>
      <JsonLd data={breadcrumbs([{ name: "Hotels near Gatwick", path: "/gatwick/hotels" }])} />
      <DarkBand heading="Hotels near Gatwick" eyebrow="STAY NEAR THE AIRPORT">
        <p className="m-0 max-w-[760px] text-[18px] leading-[1.45] text-[#e5e7eb]">
          Early flight or late landing? Compare hotels around Gatwick, Crawley and Horley with live prices for your dates, and
          book in a few taps.
        </p>
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
        <section
          className="flex flex-col gap-4 rounded-[24px] border border-line bg-[#f8fafc] p-3 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px] sm:p-6"
          aria-labelledby="hotels-heading"
        >
          <h2 id="hotels-heading" className={`${h2} px-2 pt-2 sm:px-0 sm:pt-0`}>
            Hotels and prices for your dates
          </h2>
          <HotelsWidget />
          <p className="m-0 px-2 text-[13.5px] text-muted sm:px-0">
            Bookings are made on {HOTELS_DOMAIN} with our partner Nuitée, who take the payment and look after your stay. Prices
            are per room per night unless shown otherwise.
          </p>
        </section>

        <section
          className="flex flex-wrap items-center justify-between gap-[18px] rounded-[26px] bg-ink p-[22px] text-[#d1d5db] sm:p-[26px]"
          aria-labelledby="lift-heading"
        >
          <div className="flex flex-[1_1_420px] flex-col gap-2">
            <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">GOING TO GATWICK FROM HOME?</span>
            <h2 id="lift-heading" className="m-0 font-heading text-[26px] leading-[1.1] tracking-[-0.02em] text-white sm:text-[28px]">
              Skip the hotel: we&apos;ll drive you to the terminal.
            </h2>
            <p className="m-0 text-[16px]">Pre-booked, fixed fare, timed to your flight. Booked separately from any hotel.</p>
          </div>
          <Link
            href="/#quote"
            className="flex min-h-[54px] flex-[1_0_auto] items-center justify-center rounded-[14px] bg-amber px-[22px] py-[14px] text-center text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink sm:flex-none"
          >
            Get a fixed price
          </Link>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="hotel-faq">
          <h2 id="hotel-faq" className={h2}>
            Good to know
          </h2>
          <div className="grid gap-[10px] md:grid-cols-2">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-[20px] border border-line bg-white">
                <summary className="flex min-h-[44px] justify-between gap-4 rounded-[20px] px-5 py-[18px] text-[17px] font-extrabold text-ink">
                  {f.q}
                  <span aria-hidden className="faq-plus text-[24px] leading-none text-[#d97706] transition-transform">
                    +
                  </span>
                </summary>
                <p className="m-0 -mt-2 px-5 pb-5">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
