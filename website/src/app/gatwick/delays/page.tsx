import type { Metadata } from "next";
import Link from "next/link";
import { breadcrumbs, JsonLd } from "@/components/flight/JsonLd";
import { DirectionCard, MonthChart, periodLabel, UkAirports } from "@/components/flight/Punctuality";
import { DarkBand } from "@/components/flight/ui";
import { CAA_CREDIT, CAA_HREF, PunctualityStats } from "@/lib/flightFormat";
import { fetchDelays } from "@/lib/flightStatus";
import { pageMetadata } from "@/lib/seo";
import { WHATSAPP_HREF } from "@/lib/site";

// "How punctual is Gatwick?" — UK Civil Aviation Authority punctuality statistics for the latest
// 12 months (imported monthly), read from the backend's cached summary (Redis only).
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata(
  "/gatwick/delays",
  "Gatwick Delays: How Punctual Is Gatwick Airport?",
  "How many Gatwick flights are on time, month by month, and how Gatwick compares with Heathrow, Stansted, Luton and other UK airports. From the Civil Aviation Authority's figures.",
);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS[m - 1] ?? ""} ${y}`;
};

function lead(to: string, a: PunctualityStats | null, d: PunctualityStats | null) {
  const parts = [a && `${a.onTimePct}% of arrivals`, d && `${d.onTimePct}% of departures`].filter(Boolean) as string[];
  return (
    <>
      In the 12 months to {monthName(to)},{" "}
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 && " and "}
          <strong className="text-white">{p}</strong>
        </span>
      ))}{" "}
      {parts.length > 1 ? "were" : "was"} on time: early, or up to 15 minutes late.
    </>
  );
}

export default async function DelaysPage() {
  const r = await fetchDelays();
  const crumbs = <JsonLd data={breadcrumbs([{ name: "Gatwick delays", path: "/gatwick/delays" }])} />;

  if (r.status !== "FOUND") {
    return (
      <>
        {crumbs}
        <DarkBand heading="How punctual is Gatwick?" eyebrow="GATWICK DELAYS · CAA FIGURES">
          <p className="m-0 max-w-[760px] text-[18px] text-[#e5e7eb]">
            The figures aren&apos;t available right now. For a flight today, check our{" "}
            <Link href="/flight-status" className="font-bold text-[#fbbf24] hover:text-[#fde68a]">
              live Gatwick flight status
            </Link>
            .
          </p>
        </DarkBand>
      </>
    );
  }

  const { gatwick: g } = r;
  return (
    <>
      {crumbs}
      <DarkBand heading="How punctual is Gatwick?" eyebrow="GATWICK DELAYS · CAA FIGURES">
        <p className="m-0 max-w-[760px] text-[18px] leading-[1.45] text-[#e5e7eb] sm:text-[19px]">{lead(r.to, g.arrivals, g.departures)}</p>
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
        <div className="grid gap-3 md:grid-cols-2">
          {g.arrivals && <DirectionCard title="Arrivals" s={g.arrivals} onTimeWord="on time" />}
          {g.departures && <DirectionCard title="Departures" s={g.departures} onTimeWord="left on time" />}
        </div>

        <MonthChart months={g.months} />

        <UkAirports airports={r.airports} />

        <p className="m-0 text-[15px]">
          <Link href="/gatwick/terminals#most-punctual">Most punctual airlines at Gatwick</Link> ·{" "}
          <Link href="/gatwick/terminals">Which terminal is my airline?</Link> ·{" "}
          <Link href="/flight-status">Live Gatwick flight status</Link>
        </p>

        <section
          className="flex flex-wrap items-center justify-between gap-[18px] rounded-[26px] bg-ink p-[22px] text-[#d1d5db] sm:p-[26px]"
          aria-labelledby="book-heading"
        >
          <div className="flex flex-[1_1_420px] flex-col gap-2">
            <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">LANDING LATE?</span>
            <h2 id="book-heading" className="m-0 font-heading text-[26px] leading-[1.1] tracking-[-0.02em] text-white sm:text-[28px]">
              We track the flight and move the pickup.
            </h2>
            <p className="m-0 text-[16px]">Pre-booked Gatwick pickups at a fixed fare. Book at least 24 hours ahead.</p>
          </div>
          <a
            href={WHATSAPP_HREF}
            className="flex min-h-[54px] flex-[1_0_auto] items-center justify-center rounded-[14px] bg-amber px-[22px] py-[14px] text-center text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink sm:flex-none"
          >
            Book a pickup on WhatsApp
          </a>
        </section>

        <p className="m-0 text-[13.5px] text-muted">
          On time = early or up to 15 minutes late. Early flights count as zero delay in the average. Cancelled flights are those
          cancelled less than 24 hours before departure. {CAA_CREDIT}, {periodLabel(r.from, r.to)}.{" "}
          <a href={CAA_HREF} className="font-semibold" rel="noopener">
            CAA punctuality statistics
          </a>
        </p>
      </div>
    </>
  );
}
