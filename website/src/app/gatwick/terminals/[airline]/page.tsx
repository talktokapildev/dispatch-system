import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Board from "@/components/flight/Board";
import { AirlineTag } from "@/components/flight/bits";
import { breadcrumbs, JsonLd } from "@/components/flight/JsonLd";
import { DarkBand, h2 } from "@/components/flight/ui";
import { AirlinePunctualitySection } from "@/components/flight/Punctuality";
import { BookBand, CHANGE_QA, MeetingPoints, QuestionList, SHUTTLE_QA, TerminalPill, TICKET_QA } from "@/components/terminals/parts";
import {
  ago,
  AirlineTerminal,
  dayLabel,
  daysCovered,
  Direction,
  lastDays,
  possessive,
  terminalAnswer,
  terminalCaveat,
  terminalEvidence,
  terminalName,
} from "@/lib/flightFormat";
import { fetchAirlineTerminal } from "@/lib/flightStatus";
import { pageMetadata } from "@/lib/seo";

// Rendered on every request from the backend's cached summary and board (no provider units).
export const dynamic = "force-dynamic";

type Props = { params: { airline: string }; searchParams: { board?: string } };

const cleanSlug = (s: string) => decodeURIComponent(s).toLowerCase();
const short = (t: AirlineTerminal["terminal"]) => (t === "NORTH" ? "North" : t === "SOUTH" ? "South" : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = cleanSlug(params.airline);
  const r = await fetchAirlineTerminal(slug);
  if (r.status !== "FOUND") return { title: "Gatwick terminal", robots: { index: false } };
  const a = r.airline;
  const t = short(a.terminal);
  const lead =
    a.terminal === "BOTH"
      ? `${a.name} uses both Gatwick terminals, depending on the flight.`
      : t && a.moved
        ? `${a.name} uses Gatwick's ${t} Terminal (moved from ${dayLabel(a.moved.since)}).`
        : t
          ? `${a.name} uses Gatwick's ${t} Terminal (${a.terminal === "NORTH" ? a.north : a.south} of ${a.north + a.south} flights ${lastDays(daysCovered(a.firstDate))}).`
          : `Which Gatwick terminal does ${a.name} use?`;
  const meta = pageMetadata(
    `/gatwick/terminals/${a.slug}`,
    `${a.name} Gatwick Terminal: North or South?`,
    `${lead} See ${possessive(a.name)} flights at Gatwick today, where to meet your driver and how to get between the terminals.`,
  );
  // Airlines with only a few flights get a page (so links from flight pages work) but aren't indexed.
  return a.hasPage ? meta : { ...meta, robots: { index: false, follow: true } };
}

export default async function AirlineTerminalPage({ params, searchParams }: Props) {
  const slug = cleanSlug(params.airline);
  if (slug !== params.airline) redirect(`/gatwick/terminals/${slug}`);
  const r = await fetchAirlineTerminal(slug);
  if (r.status === "NOT_FOUND") notFound();
  const now = new Date();

  if (r.status !== "FOUND") {
    return (
      <>
        <DarkBand heading="Which Gatwick terminal?" eyebrow="GATWICK TERMINALS · BY AIRLINE">
          <p className="m-0 text-[17px] text-[#d1d5db]">We can&apos;t show this airline just now. Please try again in a few minutes.</p>
        </DarkBand>
        <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
          <p className="m-0 rounded-[24px] border border-line bg-white p-6 text-[17px]">
            <Link href="/gatwick/terminals">See all airlines and their terminals</Link>
          </p>
        </div>
      </>
    );
  }

  const { airline: a, board, sameTerminal } = r;
  const direction: Direction = searchParams.board === "departures" ? "DEPARTURE" : searchParams.board === "arrivals" ? "ARRIVAL" : board.departures.length > board.arrivals.length ? "DEPARTURE" : "ARRIVAL";
  const one = a.terminal === "NORTH" || a.terminal === "SOUTH" ? a.terminal : null;
  const caveat = terminalCaveat(a);
  const days = lastDays(daysCovered(a.firstDate, now));
  const live = !!board.fetchedAt && !board.stale;
  const faq = [
    {
      q: `Which terminal does ${a.name} use at Gatwick?`,
      a: `${terminalAnswer(a)} ${terminalEvidence(a, now)}${caveat ? ` ${caveat}` : ""}`,
    },
    TICKET_QA,
    SHUTTLE_QA,
    {
      q: "How early should I get to the airport?",
      a: "Two hours before a short-haul flight is a safe rule, and three for long-haul. Your airline's bag drop closing time is the real deadline, so check it on your booking.",
    },
    CHANGE_QA,
  ];

  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Gatwick terminals", path: "/gatwick/terminals" },
          { name: a.name, path: `/gatwick/terminals/${a.slug}` },
        ])}
      />
      <DarkBand heading={`${a.name} at Gatwick: North or South Terminal?`} eyebrow="WHICH GATWICK TERMINAL?" gatwick={board.weather?.LGW}>
        <div className="flex flex-col gap-3 rounded-[22px] bg-ink-2 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <AirlineTag iata={a.codes[0] ?? null} name={a.name} size="lg" />
            <TerminalPill t={a.terminal} large />
          </div>
          <p className="m-0 font-heading text-[clamp(24px,3vw,32px)] font-bold leading-[1.15] tracking-[-0.02em] text-white">
            {terminalAnswer(a)}
          </p>
          <p className="m-0 text-[16px] text-[#e5e7eb]">{terminalEvidence(a, now)}</p>
          {caveat && <p className="m-0 text-[15px] text-[#c4c9d1]">{caveat}</p>}
        </div>
      </DarkBand>

      <div className="mx-auto -mt-[72px] flex max-w-site flex-col gap-12 px-3 pb-24 sm:-mt-24 sm:px-6">
        {a.moved && (
          <p className="m-0 rounded-[20px] border-[1.5px] border-[#f0a73a] bg-[#fdf0d8] px-5 py-4 text-[16.5px] text-[#7c2d12] shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)]">
            <strong>
              {a.name} moved to the {terminalName(a.moved.to)} from {dayLabel(a.moved.since)}.
            </strong>{" "}
            Before that, its flights used the {terminalName(a.moved.from)}. If you booked a while ago, check which terminal your
            booking shows.
          </p>
        )}

        <div className="rounded-[24px] border border-line bg-[#f8fafc] p-3 shadow-[0_40px_80px_-48px_rgba(15,23,42,0.45)] sm:rounded-[28px] sm:p-6">
          {live ? (
            <Board
              data={board}
              direction={direction}
              full={false}
              showAll
              now={now}
              title={`${a.name} ${direction === "ARRIVAL" ? "arrivals" : "departures"} at Gatwick`}
              emptyText={`No more ${a.name} ${direction === "ARRIVAL" ? "arrivals" : "departures"} on our live board for the next few hours.`}
              tabHref={(d) => `/gatwick/terminals/${a.slug}?board=${d === "DEPARTURE" ? "departures" : "arrivals"}`}
            />
          ) : (
            <div className="flex flex-col gap-2 px-2 py-4">
              <h2 className={h2}>Live {a.name} flights aren&apos;t available right now</h2>
              <p className="m-0 text-[16.5px]">
                The terminal above still comes from this week&apos;s flights. To check one flight, use our{" "}
                <Link href="/flight-status">Gatwick flight status</Link> page.
              </p>
            </div>
          )}
        </div>

        <AirlinePunctualitySection p={r.punctuality} name={a.name} />

        <MeetingPoints only={one ?? undefined} />

        {sameTerminal.length > 0 && one && (
          <section className="flex flex-col gap-3" aria-labelledby="same-heading">
            <h2 id="same-heading" className={h2}>
              Also at the {terminalName(one)}
            </h2>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {sameTerminal.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/gatwick/terminals/${s.slug}`}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 font-bold text-ink no-underline hover:border-[#cbd5e1] hover:text-ink"
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <BookBand terminal={one} />
        <QuestionList items={faq} />

        <p className="m-0 text-[13.5px] text-muted">
          Updated {ago(r.updatedAt, now)}. Terminal counted from the terminals Gatwick published for {possessive(a.name)} flights {days}.
          Times are UK time. Flight details can change: always check with your airline.{" "}
          <Link href="/gatwick/terminals">All airlines and their terminals</Link>
        </p>
      </div>
    </>
  );
}
