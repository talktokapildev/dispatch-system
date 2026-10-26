import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatIcon, PhoneIcon } from "@/components/Icons";
import PhoneBooking from "@/components/PhoneBooking";
import { JsonLd, breadcrumbs } from "@/components/flight/JsonLd";
import QuoteCalculator from "@/components/quote/QuoteCalculator";
import { AREAS, areaPath, findArea, type Area } from "@/lib/areas";
import { pageMetadata } from "@/lib/seo";
import { PHONE_DISPLAY, PHONE_HREF, TFL_LICENCE, WHATSAPP_HREF } from "@/lib/site";

// Local landing pages, e.g. /gatwick-taxi/horsham. Static: one page per entry in lib/areas.ts.
export const dynamicParams = false;

export function generateStaticParams() {
  return AREAS.map((a) => ({ town: a.slug }));
}

export function generateMetadata({ params }: { params: { town: string } }): Metadata {
  const area = findArea(params.town);
  if (!area) return {};
  return pageMetadata(areaPath(area.slug), `${area.town} to Gatwick Taxi`, area.description);
}

const h2 =
  "m-0 font-heading text-[clamp(28px,3.4vw,42px)] font-bold leading-[1.05] tracking-[-0.035em] text-ink";
const h3 = "m-0 font-heading text-[20px] font-bold tracking-[-0.015em] text-ink";
const card = "flex flex-col gap-2 rounded-[22px] border border-line bg-white p-6";

function faqs(a: Area): { q: string; a: string }[] {
  return [
    {
      q: `How long does it take from ${a.town} to Gatwick?`,
      a: `The drive is ${a.drive}. For a departure we'll suggest a pickup time that gets you to your terminal with time to spare.`,
    },
    {
      q: `How much is a taxi from ${a.town} to Gatwick?`,
      a: `Use the price checker on this page for your exact address. The fare is fixed when you book, so traffic and flight delays won't change it.`,
    },
    {
      q: "Can you pick me up when I land?",
      a: "Yes. Add your flight number when you book. We track it live and move your pickup if you're late. At North Terminal we meet you at Car Park 6, Level 4; at South Terminal, Orange Car Park, Level 3.",
    },
    {
      q: "Do I need the app?",
      a: `No. You can call us on ${PHONE_DISPLAY} or WhatsApp us and we'll book it for you. The app is there if you'd like to see your fare and booking yourself.`,
    },
    {
      q: "How far ahead should I book?",
      a: "At least 24 hours. Every trip is pre-booked and planned before the day. Your driver waits 10 minutes free from your pickup time, and you can cancel free up to 15 minutes before.",
    },
  ];
}

export default function AreaPage({ params }: { params: { town: string } }) {
  const area = findArea(params.town);
  if (!area) notFound();
  const path = areaPath(area.slug);
  const qa = faqs(area);
  const others = AREAS.filter((a) => a.slug !== area.slug);

  return (
    <>
      <JsonLd data={breadcrumbs([{ name: `${area.town} to Gatwick taxi`, path }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: qa.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />

      {/* Heading */}
      <section className="mx-auto flex max-w-site flex-col gap-6 px-6 pb-8 pt-8 sm:pb-12 sm:pt-10">
        <nav aria-label="Breadcrumb" className="text-[14px] font-semibold text-soft">
          <Link href="/" className="text-soft">
            Home
          </Link>{" "}
          › {area.town} to Gatwick
        </nav>
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-line bg-white py-[6px] pl-[6px] pr-[14px] text-[14px] font-semibold text-soft">
          <span className="whitespace-nowrap rounded-full bg-ink px-[10px] py-[3px] text-[12.5px] font-bold text-white">
            TfL {TFL_LICENCE}
          </span>
          Local, licensed, pre-booked
        </span>
        <h1 className="m-0 max-w-[900px] text-balance font-heading text-[clamp(38px,5vw,66px)] font-bold leading-[1] tracking-[-0.04em] text-ink">
          {area.town} to Gatwick taxi,{" "}
          <span className="text-accent">planned to the minute.</span>
        </h1>
        <p className="m-0 max-w-[620px] text-pretty text-[19px]">{area.intro}</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="#quote"
            className="inline-flex min-h-[56px] items-center justify-center rounded-[16px] bg-amber px-6 py-[15px] text-[17px] font-extrabold text-ink no-underline hover:text-ink max-sm:w-full"
          >
            Get a price
          </a>
          <a
            href={WHATSAPP_HREF}
            className="inline-flex min-h-[56px] items-center justify-center gap-[10px] rounded-[16px] border-[1.5px] border-[#d1d5db] bg-white px-[22px] py-[15px] text-[17px] font-bold text-ink no-underline hover:text-ink max-sm:flex-auto max-sm:px-4"
          >
            <ChatIcon />
            WhatsApp us
          </a>
          <a
            href={PHONE_HREF}
            aria-label={`Call ${PHONE_DISPLAY}`}
            className="inline-flex min-h-[56px] items-center justify-center gap-[10px] rounded-[16px] border-[1.5px] border-[#d1d5db] bg-white px-[22px] py-[15px] text-[17px] font-bold text-ink no-underline hover:text-ink max-sm:flex-auto max-sm:px-4"
          >
            <PhoneIcon size={18} />
            Call {PHONE_DISPLAY}
          </a>
        </div>
      </section>

      {/* Price checker */}
      <section id="quote" aria-labelledby="quote-heading" className="scroll-mt-16 px-4 pb-12 sm:px-6 sm:pb-16">
        <div className="mx-auto max-w-[1240px] rounded-[28px] border border-[#fde7b0] bg-[#fff6e5] p-3 sm:rounded-[36px] sm:px-[clamp(20px,3vw,40px)] sm:py-10">
          <div className="mx-auto flex max-w-[1080px] flex-col gap-4">
            <QuoteCalculator />
            <PhoneBooking />
          </div>
        </div>
      </section>

      {/* Why a car */}
      <section className="mx-auto flex max-w-site flex-col gap-8 px-6 pb-16">
        <h2 className={h2}>Why book a car from {area.town}?</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
          <div className={card}>
            <h3 className={h3}>Door to door, bags and all</h3>
            <p className="m-0">
              No drive to {area.station}, no parking, no carrying suitcases on and off the
              train. We collect you from your door and drop you at your terminal.
            </p>
          </div>
          <div className={card}>
            <h3 className={h3}>Nobody has to give you a lift</h3>
            <p className="m-0">
              Early flight or late landing, you don&apos;t need to ask family or friends to drive
              to Gatwick and back. The fare is fixed when you book.
            </p>
          </div>
          <div className={card}>
            <h3 className={h3}>We watch your flight home</h3>
            <p className="m-0">
              Add your flight number and we track it live. If you&apos;re late, your pickup moves
              later automatically, and you&apos;ll get a text when you land.
            </p>
          </div>
        </div>
      </section>

      {/* Coming home */}
      <section className="mx-auto flex max-w-site flex-col gap-6 px-6 pb-16">
        <h2 className={h2}>Coming home to {area.town}</h2>
        <p className="m-0 max-w-[720px] text-[17px]">
          Your driver meets you at a fixed spot at your terminal, and your landing text tells you
          where to go.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
          <div className={card}>
            <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
              NORTH TERMINAL
            </span>
            <strong className="text-[19px] text-ink">Car Park 6, Level 4</strong>
          </div>
          <div className={card}>
            <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
              SOUTH TERMINAL
            </span>
            <strong className="text-[19px] text-ink">Orange Car Park, Level 3</strong>
          </div>
        </div>
        <p className="m-0 text-[15px] text-soft">
          Not sure which terminal?{" "}
          <Link href="/gatwick/terminals">Check your airline&apos;s Gatwick terminal</Link> or{" "}
          <Link href="/flight-status">look up your flight</Link>.
        </p>
      </section>

      {/* Places */}
      <section className="mx-auto flex max-w-site flex-col gap-5 px-6 pb-16">
        <h2 className={h2}>Across {area.district}</h2>
        <p className="m-0 max-w-[720px] text-[17px]">
          We cover {area.town} and the villages around it, including:
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {area.places.map((p) => (
            <li
              key={p}
              className="rounded-full border border-line bg-white px-4 py-2 text-[15px] font-semibold text-ink"
            >
              {p}
            </li>
          ))}
        </ul>
        <p className="m-0 text-[15px] text-soft">
          Somewhere else nearby? Put your address in the price checker above.
        </p>
      </section>

      {/* FAQ */}
      <section className="mx-auto grid max-w-site grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-11 px-6 pb-16">
        <h2 className={h2}>Good to know</h2>
        <div className="flex flex-col gap-[10px]">
          {qa.map((f, i) => (
            <details key={f.q} open={i === 0} className="rounded-[20px] border border-line bg-white">
              <summary className="flex justify-between gap-4 rounded-[20px] px-[22px] py-5 text-[18px] font-extrabold text-ink">
                {f.q}
                <span aria-hidden className="faq-plus text-[24px] leading-none text-[#d97706] transition-transform">
                  +
                </span>
              </summary>
              <p className="m-0 -mt-[10px] px-[22px] pb-5">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {others.length > 0 && (
        <section className="mx-auto max-w-site px-6 pb-[96px]">
          <p className="m-0 text-[16px]">
            Also covering:{" "}
            {others.map((o, i) => (
              <span key={o.slug}>
                {i > 0 && " · "}
                <Link href={areaPath(o.slug)}>{o.town} to Gatwick</Link>
              </span>
            ))}
          </p>
        </section>
      )}
    </>
  );
}
