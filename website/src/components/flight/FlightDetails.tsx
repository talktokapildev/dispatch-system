import Link from "next/link";
import {
  BoardFlight,
  dayLabel,
  duration,
  FlightView,
  minutesBetween,
  placeName,
  plainEnglish,
  shownNumber,
  terminalName,
  ukDate,
  ukTime,
} from "@/lib/flightFormat";
import { WHATSAPP_HREF } from "@/lib/site";
import { Fact, h2 } from "./ui";

// Our own meeting points (same as the home page "Gatwick specialists" section).
const MEET = { NORTH: "Car Park 6, Level 4", SOUTH: "Orange Car Park, Level 3" } as const;
const BOOK_AHEAD_HOURS = 24;

/** "At Gatwick" facts. Anything the airport hasn't published is left out, not shown empty. */
export function GatwickFacts({ f }: { f: BoardFlight }) {
  const arrival = f.direction === "ARRIVAL";
  const flightMin = arrival
    ? minutesBetween(f.other.scheduledUtc, f.lgw.scheduledUtc)
    : minutesBetween(f.lgw.scheduledUtc, f.other.scheduledUtc);
  const term = terminalName(f.lgw.terminal);
  const facts = [
    {
      label: "Terminal",
      value: term ? term.replace(" Terminal", "") : "Not shown yet",
      note: !term
        ? "Check with the airline"
        : f.lgw.terminalInferred
          ? `${f.airline.name ?? "This airline"}'s other flights today use ${term.replace(" Terminal", "")}: check your booking`
          : `Not ${f.lgw.terminal === "NORTH" ? "South" : "North"}: check before you set off`,
    },
    arrival && f.lgw.baggageBelt ? { label: "Baggage belt", value: f.lgw.baggageBelt } : null,
    !arrival && f.lgw.checkInDesk ? { label: "Check-in desks", value: f.lgw.checkInDesk } : null,
    f.lgw.gate ? { label: arrival ? "Arrival gate" : "Gate", value: f.lgw.gate } : null,
    flightMin && flightMin > 0 && flightMin < 24 * 60 ? { label: "Flight time", value: duration(flightMin).replace(" min", "m").replace(" h ", "h ") } : null,
    f.aircraft ? { label: "Aircraft", value: f.aircraft.replace(/^(Airbus|Boeing|Embraer|ATR|De Havilland Canada)\s+/i, ""), note: f.aircraft.split(" ")[0] } : null,
  ].filter((x): x is { label: string; value: string; note?: string } => !!x);

  return (
    <section className="flex flex-col gap-[14px]" aria-labelledby="at-gatwick">
      <h2 id="at-gatwick" className={h2}>
        At Gatwick
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] sm:gap-3">
        {facts.map((x) => (
          <Fact key={x.label} label={x.label} value={x.value} note={x.note} />
        ))}
      </div>
    </section>
  );
}

export function PlainEnglish({ f, v, now }: { f: BoardFlight; v: FlightView; now: Date }) {
  return (
    <section className="flex flex-col gap-3 rounded-[22px] border border-line bg-white px-5 py-5 sm:px-[26px] sm:py-6" aria-labelledby="plain">
      <h2 id="plain" className="m-0 font-heading text-[22px] font-bold tracking-[-0.02em] text-ink">
        In plain English
      </h2>
      <p className="m-0 text-[17px] text-soft">{plainEnglish(f, v, now)}</p>
    </section>
  );
}

function whatsappText(f: BoardFlight, v: FlightView): string {
  const day = dayLabel(ukDate(v.scheduledAt));
  const term = terminalName(f.lgw.terminal) ?? "Gatwick";
  const lines =
    f.direction === "ARRIVAL"
      ? [
          "Hi OrangeRide, I'd like a pickup from Gatwick:",
          `Flight: ${shownNumber(f)} from ${placeName(f.other)}, landing ${day} at ${ukTime(v.scheduledAt)} (${term})`,
          "Going to: ",
          "Passengers and bags: ",
        ]
      : [
          "Hi OrangeRide, I'd like a lift to Gatwick:",
          `Flight: ${shownNumber(f)} to ${placeName(f.other)}, leaving ${day} at ${ukTime(v.scheduledAt)} (${term})`,
          "Pickup from: ",
          "Passengers and bags: ",
        ];
  return `${WHATSAPP_HREF}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/**
 * The OrangeRide panel. Bookings need 24 hours' notice, so for a flight sooner than that the
 * panel offers the next trip instead of promising a pickup for this one.
 */
export function BookPanel({ f, v, now }: { f: BoardFlight; v: FlightView; now: Date }) {
  const arrival = f.direction === "ARRIVAL";
  const hoursAway = (Date.parse(v.scheduledAt) - now.getTime()) / 3_600_000;
  const canBookThis = hoursAway >= BOOK_AHEAD_HOURS && !["CANCELLED", "MAYBE_CANCELLED", "DIVERTED"].includes(v.state);
  const meet = f.lgw.terminal ? MEET[f.lgw.terminal] : null;
  const term = terminalName(f.lgw.terminal);

  const heading = canBookThis
    ? arrival
      ? "Let us collect them from this flight."
      : `Get to ${term ?? "Gatwick"} by ${ukTime(v.beThereBy)}.`
    : arrival
      ? "Need a Gatwick pickup another day?"
      : "Flying from Gatwick again?";
  const body = canBookThis
    ? arrival
      ? `Our driver tracks ${shownNumber(f)} and moves the pickup if it's late. They get a text with the meeting point when they land.`
      : "Pre-booked, fixed fare, licensed driver. No parking to find and no drop-off charge to pay."
    : arrival
      ? "Book at least 24 hours ahead. We track the flight and move the pickup if it's late, at a fixed fare."
      : "Book at least 24 hours ahead for a fixed-fare lift to the terminal, timed to your flight.";

  return (
    <section className="flex flex-col gap-[14px] rounded-[26px] bg-ink p-[22px] text-[#d1d5db] sm:p-[26px]" aria-labelledby="book">
      <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">
        {arrival ? "PICKING SOMEONE UP?" : "NEED A LIFT TO GATWICK?"}
      </span>
      <h2 id="book" className="m-0 font-heading text-[26px] leading-[1.1] tracking-[-0.02em] text-white sm:text-[28px]">
        {heading}
      </h2>
      <p className="m-0 text-[16px]">{body}</p>
      {meet && arrival && (
        <div className="flex flex-col gap-1 rounded-[18px] bg-ink-2 px-[18px] py-4">
          <span className="text-[14px] text-[#c4c9d1]">Our meeting point at {term}</span>
          <strong className="text-[20px] text-white">{meet}</strong>
        </div>
      )}
      <a
        href={canBookThis ? whatsappText(f, v) : WHATSAPP_HREF}
        className="flex min-h-[54px] items-center justify-center rounded-[14px] bg-amber px-[18px] py-[14px] text-center text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink"
      >
        {canBookThis ? (arrival ? "Book a pickup on WhatsApp" : "Book a lift on WhatsApp") : "Ask us on WhatsApp"}
      </a>
      <Link href="/#quote" className="py-2 text-center text-[15px] font-bold text-[#fbbf24] hover:text-[#fde68a]">
        Get a fixed price first
      </Link>
    </section>
  );
}

/** "Meeting them yourself" / "Dropping someone off?" */
export function Tips({ f, v }: { f: BoardFlight; v: FlightView }) {
  const arrival = f.direction === "ARRIVAL";
  const term = terminalName(f.lgw.terminal) ?? "the right terminal";
  const items = arrival
    ? [
        [`Arrive around ${ukTime(v.outHandAt)}.`, "Passengers are rarely out sooner than 30 minutes after the plane reaches the gate."],
        [`Park in ${term} short stay.`, "You can't wait in the drop-off zone."],
        ["Meet them at the arrivals exit.", "Ask them to message you once they've collected their bags."],
      ]
    : [
        [`Go to ${term}.`, "Each terminal has its own drop-off zone, and the free shuttle between them takes a few minutes."],
        ["There's a charge for the drop-off zone.", "Check Gatwick's website for the current fee and how to pay."],
        ["Stopping is for drop-off only.", "To wait or go inside with them, use short stay parking."],
      ];
  return (
    <section className="flex flex-col gap-[14px] rounded-[22px] border border-line bg-white p-[22px]" aria-labelledby="tips">
      <h2 id="tips" className="m-0 font-heading text-[20px] font-bold text-ink">
        {arrival ? "Meeting them yourself" : "Dropping someone off?"}
      </h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
        {items.map(([strong, rest], i) => (
          <li key={strong} className="grid grid-cols-[28px_1fr] gap-[10px]">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-[#fdf0d8] text-[14px] font-extrabold text-accent-dark">
              {i + 1}
            </span>
            <span>
              <strong className="text-ink">{strong}</strong> {rest}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
