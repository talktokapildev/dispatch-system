import type { Metadata } from "next";
import Link from "next/link";
import AutoRefresh from "@/components/flight/AutoRefresh";
import Board from "@/components/flight/Board";
import FlightFaq from "@/components/flight/FlightFaq";
import FlightSearch from "@/components/flight/FlightSearch";
import { DarkBand, h2 } from "@/components/flight/ui";
import type { Direction } from "@/lib/flightFormat";
import { fetchBoard } from "@/lib/flightStatus";
import { pageMetadata } from "@/lib/seo";
import { WHATSAPP_HREF } from "@/lib/site";

// Rendered on every request from the backend's cached board (no provider units).
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata(
  "/flight-status",
  "Gatwick flight status: live arrivals and departures",
  "Is the flight on time? Live Gatwick arrivals and departures in plain English: when it lands, when they'll be out of arrivals, terminal, gate and baggage belt.",
);

export default async function FlightStatusPage({ searchParams }: { searchParams: { dir?: string } }) {
  const direction: Direction = searchParams.dir === "departures" ? "DEPARTURE" : "ARRIVAL";
  const now = new Date();
  const board = await fetchBoard();
  const available = !!board?.fetchedAt && !board.stale;

  return (
    <>
      <AutoRefresh />
      <DarkBand heading="Is the flight on time?" gatwick={board?.weather?.LGW}>
        <FlightSearch />
        <p className="m-0 mt-3 text-[14.5px] text-[#c4c9d1]">
          Arrivals and departures at Gatwick. Type the number from the ticket, like EZY8687 or BA2541, and we&apos;ll work out
          whether it&apos;s landing or leaving.
        </p>
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
        <div className="rounded-[24px] border border-line bg-[#f8fafc] p-3 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px] sm:p-6">
          {available ? (
            <Board
              data={board!}
              direction={direction}
              full
              now={now}
              tabHref={(d) => (d === "DEPARTURE" ? "/flight-status?dir=departures" : "/flight-status")}
            />
          ) : (
            <div className="flex flex-col gap-2 px-2 py-4">
              <h2 className={h2}>The live board isn&apos;t available right now</h2>
              <p className="m-0 text-[16.5px]">
                You can still look up a flight above. If it&apos;s urgent, check with the airline or{" "}
                <a href="https://www.gatwickairport.com/">Gatwick Airport&apos;s website</a>.
              </p>
            </div>
          )}
        </div>

        <section className="grid gap-6 rounded-[28px] bg-ink px-6 py-8 text-[#d1d5db] sm:px-10 sm:py-10 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">GATWICK TRANSFERS</span>
            <h2 className="m-0 font-heading text-[clamp(26px,3vw,34px)] leading-[1.08] tracking-[-0.02em] text-white">
              Flying soon? We&apos;ll time your pickup to the flight.
            </h2>
            <p className="m-0 text-[16.5px]">
              Pre-booked, fixed fares from Crawley and Horley. For airport pickups our driver tracks the flight and moves the
              pickup if it&apos;s late. Book at least 24 hours ahead.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/#quote"
              className="flex min-h-[54px] items-center justify-center rounded-[14px] bg-amber px-5 text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink"
            >
              Get a fixed price
            </Link>
            <a href={WHATSAPP_HREF} className="py-2 text-center text-[15px] font-bold text-[#fbbf24] hover:text-[#fde68a]">
              Or ask us on WhatsApp
            </a>
          </div>
        </section>

        <FlightFaq />
      </div>
    </>
  );
}
