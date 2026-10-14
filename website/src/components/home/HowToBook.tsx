import { PhoneText } from "../Responsive";
import type { ReactNode } from "react";
import { EMAIL_HREF, PHONE_HREF, WHATSAPP_HREF } from "@/lib/site";
import StoreBadges from "../StoreBadges";

/** "How to book": three steps plus a contact bar. Step 2's illustration can later become a fare checker. */

function Step({
  n,
  title,
  art,
  text,
  short,
}: {
  n: number;
  title: string;
  art: ReactNode;
  text: string;
  short: string;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-[28px] border border-line bg-white p-[26px]">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-ink font-extrabold text-white">
          {n}
        </span>
        <h3 className="m-0 text-[20px] font-extrabold text-ink">{title}</h3>
      </div>
      {art}
      <p className="m-0">
        <PhoneText full={text} short={short} />
      </p>
    </li>
  );
}

const ScheduleArt = (
  <div
    aria-hidden
    className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] border border-line bg-[#f8fafc] p-[14px]"
  >
    <span className="flex gap-1 rounded-full border border-line bg-white p-[3px]">
      <span className="px-3 py-[5px] text-[13px] font-bold text-muted">Now</span>
      <span className="rounded-full bg-[#e9a23b] px-3 py-[5px] text-[13px] font-extrabold text-ink">
        Schedule
      </span>
    </span>
    <span className="rounded-full border border-[#fde7b0] bg-[#fffbeb] px-3 py-[5px] text-[13px] font-bold text-accent-dark">
      Mon 12 Oct · 05:30
    </span>
  </div>
);

const FareArt = (
  <div
    aria-hidden
    className="grid grid-cols-3 rounded-[20px] border border-[#fde7b0] bg-[#fffbeb] p-[14px] text-center"
  >
    {[
      ["£", "Fare"],
      ["mi", "Distance"],
      ["min", "Duration"],
    ].map(([v, l]) => (
      <span key={l} className="flex flex-col">
        <strong className="text-[18px] text-accent-dark">{v}</strong>
        <span className="text-[12px]">{l}</span>
      </span>
    ))}
  </div>
);

const TrackArt = (
  <div
    aria-hidden
    className="flex flex-col gap-2 rounded-[20px] border border-line bg-[#f8fafc] p-[14px]"
  >
    <span className="flex items-center justify-between">
      <span className="text-[13px] font-extrabold text-accent-dark">Your booking</span>
      <span className="rounded-full border border-[#bbf7d0] bg-[#dcfce7] px-[9px] py-[3px] text-[11px] font-extrabold tracking-[0.06em] text-[#15803d]">
        DRIVER ASSIGNED
      </span>
    </span>
    <span className="flex items-center gap-2 text-[13.5px] text-soft">
      <span className="h-2 w-2 rounded-[4px] bg-[#22c55e]" />
      Gatwick North Terminal
    </span>
    <span className="flex items-center gap-2 text-[13.5px] text-soft">
      <span className="h-2 w-2 rounded-[4px] bg-[#ef4444]" />
      Your drop-off
    </span>
  </div>
);

const contactBtn =
  "inline-flex min-h-[44px] items-center rounded-[12px] px-[18px] py-[11px] text-ink no-underline hover:text-ink";

export default function HowToBook() {
  return (
    <section id="how" className="mx-auto flex max-w-site flex-col gap-10 px-6 pb-[104px]">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex max-w-[680px] flex-col gap-3">
          <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
            HOW TO BOOK
          </span>
          <h2 className="m-0 font-heading text-[clamp(32px,4vw,50px)] font-bold leading-[1.04] tracking-[-0.035em] text-ink">
            Book in the app, or just message us.
          </h2>
        </div>
        <div className="flex flex-wrap gap-[10px]">
          <StoreBadges />
        </div>
      </div>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-[18px] p-0">
        <Step
          n={1}
          title="Schedule your ride"
          art={ScheduleArt}
          text="In the app, choose a date and time at least 24 hours ahead. If you're arriving at Gatwick, add your flight number."
          short="Pick a date and time 24+ hours ahead. Landing at Gatwick? Add your flight."
        />
        <Step
          n={2}
          title="See your fixed fare"
          art={FareArt}
          text="The total is shown before you confirm. Pay by card, Apple Pay, Google Pay or cash."
          short="See the total before you confirm. Card, Apple Pay, Google Pay or cash."
        />
        <Step
          n={3}
          title="Track your driver"
          art={TrackArt}
          text="On the day, follow your driver on the map. You can manage or cancel the booking under Rides."
          short="Follow your driver on the map on the day."
        />
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-[22px] border border-line bg-white px-[22px] py-[18px]">
        <span className="text-[17px]">
          <PhoneText
            full={
              <>
                <strong className="text-ink">Prefer to talk to someone?</strong> WhatsApp, call or
                email us and we&apos;ll book it for you.
              </>
            }
            short={
              <>
                <strong className="text-ink">Prefer to talk?</strong> We&apos;ll book it for you.
              </>
            }
          />
        </span>
        <span className="flex flex-wrap gap-[10px]">
          <a href={WHATSAPP_HREF} className={`${contactBtn} bg-amber font-extrabold`}>
            WhatsApp
          </a>
          <a href={PHONE_HREF} className={`${contactBtn} bg-page font-bold`}>
            Call
          </a>
          <a href={EMAIL_HREF} className={`${contactBtn} bg-page font-bold`}>
            Email
          </a>
        </span>
      </div>
    </section>
  );
}
