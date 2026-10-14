import Link from "next/link";
import type { ReactNode } from "react";
import { EMAIL_HREF, WHATSAPP_HREF } from "@/lib/site";

type Item = { q: string; a: ReactNode; open?: boolean };

export const FAQS: Item[] = [
  {
    q: "How do I book?",
    a: "Download the OrangeRide app for iPhone or Android and schedule your ride. You'll see your fixed fare before you confirm. You can also WhatsApp, call or email us and we'll book it for you.",
    open: true,
  },
  {
    q: "How far ahead do I need to book?",
    a: "At least 24 hours. We only take pre-booked journeys at the moment, so every trip is planned properly in advance.",
  },
  {
    q: "What if my flight lands early or late?",
    a: "Add your arriving flight when you book. We track it live and adjust your pickup to match, then let you know by text and in the app.",
  },
  {
    q: "Where do I meet my driver at Gatwick?",
    a: "At North Terminal, it's Car Park 6, Level 4. At South Terminal, it's Orange Car Park, Level 3. The app shows your meeting point when you choose your terminal, and it's in your landing text too.",
  },
  {
    q: "Do you cover London and Heathrow?",
    a: "Yes. We're licensed by Transport for London. We take pre-booked journeys between Gatwick and London, and between Heathrow and Gatwick, Crawley, Horley, Redhill, Reigate or Horsham. Message us for a fixed fare.",
  },
  {
    q: "Is the fare really fixed?",
    a: (
      <>
        Yes. The fare you see when you book is the fare you pay, with no surge pricing and no meter
        running in traffic. Your driver waits 10 minutes free from your pickup time, and you can
        cancel free up to 15 minutes before. See our <Link href="/terms">Terms</Link> for details.
      </>
    ),
  },
];

export default function Faq() {
  return (
    <section
      id="faq"
      className="mx-auto grid max-w-site grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-11 px-6 pb-[104px]"
    >
      <div className="flex flex-col gap-[14px]">
        <h2 className="m-0 font-heading text-[clamp(32px,4vw,50px)] font-bold leading-[1.04] tracking-[-0.035em] text-ink">
          Good to know
        </h2>
        <p className="m-0 text-[17px]">
          Can&apos;t see your question? <a href={WHATSAPP_HREF}>WhatsApp us</a> or{" "}
          <a href={EMAIL_HREF}>send an email</a>.
        </p>
      </div>
      <div className="flex flex-col gap-[10px]">
        {FAQS.map((f) => (
          <details
            key={f.q}
            open={f.open}
            className="rounded-[20px] border border-line bg-white"
          >
            <summary className="flex justify-between gap-4 rounded-[20px] px-[22px] py-5 text-[18px] font-extrabold text-ink">
              {f.q}
              <span
                aria-hidden
                className="faq-plus text-[24px] leading-none text-[#d97706] transition-transform"
              >
                +
              </span>
            </summary>
            <p className="m-0 -mt-[10px] px-[22px] pb-5">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
