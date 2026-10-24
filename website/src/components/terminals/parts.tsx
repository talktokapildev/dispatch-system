import Link from "next/link";
import { MEETING_POINT, TerminalAnswer, terminalShort } from "@/lib/flightFormat";
import { WHATSAPP_HREF } from "@/lib/site";
import { h2 } from "@/components/flight/ui";

// Shared pieces of the "Which Gatwick terminal?" pages (/gatwick/terminals and its airline pages).

const PILL: Record<TerminalAnswer | "NONE", string> = {
  // North and South also differ in lightness (blue vs amber), not hue alone; the word carries the meaning.
  NORTH: "bg-[#e8effd] text-[#1e40af] border-[#9db7f0]",
  SOUTH: "bg-[#fdf0d8] text-[#92400e] border-[#f0a73a]",
  BOTH: "bg-[#eef0f3] text-soft border-[#cbd5e1]",
  NONE: "bg-white text-muted border-line",
};

/** "North" / "South" / "Both" / "Not known yet" chip. */
export function TerminalPill({ t, large = false }: { t: TerminalAnswer | null; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border-[1.5px] font-extrabold ${PILL[t ?? "NONE"]} ${
        large ? "px-4 py-[6px] text-[16px]" : "px-[10px] py-[3px] text-[13.5px]"
      }`}
    >
      {terminalShort(t)}
      {t === "NORTH" || t === "SOUTH" ? " Terminal" : ""}
    </span>
  );
}

/** Where our drivers meet arriving passengers, per terminal. */
export function MeetingPoints({ only }: { only?: "NORTH" | "SOUTH" }) {
  const list = (only ? [only] : (["NORTH", "SOUTH"] as const)).map((t) => ({ t, where: MEETING_POINT[t] }));
  return (
    <section className="flex flex-col gap-3" aria-labelledby="meet-heading">
      <h2 id="meet-heading" className={h2}>
        {only ? `Meeting your OrangeRide driver at the ${only === "NORTH" ? "North" : "South"} Terminal` : "Where our drivers meet you"}
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {list.map(({ t, where }) => (
          <div key={t} className="flex flex-col gap-1 rounded-[20px] border border-line bg-white px-5 py-[18px]">
            <span className="text-[14px] font-bold text-muted">{t === "NORTH" ? "North Terminal" : "South Terminal"}</span>
            <strong className="text-[20px] text-ink">{where}</strong>
            <span className="text-[15px]">
              Your driver tracks your flight and texts you the meeting point when you land.
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The booking band at the bottom of the terminal pages. */
export function BookBand({ terminal }: { terminal?: "NORTH" | "SOUTH" | null }) {
  const where = terminal === "NORTH" ? "the North Terminal" : terminal === "SOUTH" ? "the South Terminal" : "the right terminal";
  return (
    <section className="grid gap-6 rounded-[28px] bg-ink px-6 py-8 text-[#d1d5db] sm:px-10 sm:py-10 md:grid-cols-[1.4fr_1fr] md:items-center">
      <div className="flex flex-col gap-3">
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">GATWICK TRANSFERS</span>
        <h2 className="m-0 font-heading text-[clamp(26px,3vw,34px)] leading-[1.08] tracking-[-0.02em] text-white">
          Dropped at {where}, at a fixed fare.
        </h2>
        <p className="m-0 text-[16.5px]">
          Pre-booked rides to and from Gatwick from Crawley, Horley and nearby. For pickups our driver tracks the flight and
          moves the pickup if it&apos;s late. Book at least 24 hours ahead.
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
  );
}

/** Question-and-answer list in the same style as the flight pages. */
export function QuestionList({ items, heading = "Good to know" }: { items: { q: string; a: string }[]; heading?: string }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className={h2}>
        {heading}
      </h2>
      <div className="grid gap-[10px] md:grid-cols-2">
        {items.map((f) => (
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
  );
}

// Answers shared by both pages (kept general: nothing here depends on a particular day's data).
export const SHUTTLE_QA = {
  q: "What if I go to the wrong terminal?",
  a: "A free shuttle train links the North and South terminals and the ride takes a few minutes. Allow extra time to get to it and wait for the next train, especially if your bag drop is about to close.",
};
export const TICKET_QA = {
  q: "Where can I see my terminal?",
  a: "Your airline usually shows it in your booking confirmation or app. The day you fly, it's also on our live flight pages and on the airport's screens.",
};
export const CHANGE_QA = {
  q: "Can an airline change terminal?",
  a: "Yes. Airlines occasionally move between Gatwick's terminals, and a few flights can use the other one on the day. We update these pages from each day's flights and show it when an airline moves.",
};
