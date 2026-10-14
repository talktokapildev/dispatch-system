import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PhoneText } from "@/components/Responsive";
import { pageMetadata } from "@/lib/seo";
import {
  DRIVER_ANDROID,
  DRIVER_APPLY_URL,
  DRIVER_IOS,
  PHONE_DISPLAY,
  PHONE_HREF,
  WHATSAPP_HREF,
} from "@/lib/site";

export const metadata: Metadata = pageMetadata(
  "/drivers",
  "Drive with us",
  "Got a PCO licence? Drive with OrangeRide: planned, pre-booked airport work around Gatwick, Crawley and Horley, with live flight timing on every pickup. Apply in a few minutes.",
);

const eyebrow =
  "text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark";
const h2 =
  "m-0 font-heading text-[clamp(30px,3.6vw,44px)] font-bold leading-[1.04] tracking-[-0.035em] text-ink";
const h3 =
  "m-0 font-heading text-[21px] font-bold tracking-[-0.015em] text-ink";

function ArrowIcon({ color }: { color: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Icon({
  d,
  size = 28,
  color = "#2e3238",
  width = 2,
}: {
  d: ReactNode;
  size?: number;
  color?: string;
  width?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      {d}
    </svg>
  );
}

const CHECK = <path d="M5 12.5l4.5 4.5L19 7.5" />;
const PIN = (
  <>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>
);
const CALENDAR = (
  <>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>
);
const PLANE = (
  <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
);
const PHONE = (
  <>
    <rect x="6" y="2" width="12" height="20" rx="3" />
    <path d="M11 18h2" />
  </>
);

const NEEDS: { icon: ReactNode; text: ReactNode }[] = [
  {
    icon: CHECK,
    text: (
      <strong className="text-ink">
        TfL private hire (PCO) driver licence
      </strong>
    ),
  },
  {
    icon: CHECK,
    text: (
      <strong className="text-ink">
        At least 1 year&apos;s private hire experience
      </strong>
    ),
  },
  {
    icon: CHECK,
    text: (
      <>
        <strong className="text-ink">Your own car, under 7 years old.</strong>{" "}
        Tesla preferred.
      </>
    ),
  },
  {
    icon: CHECK,
    text: (
      <>
        <strong className="text-ink">PHV-licensed and insured</strong> for hire
        and reward
      </>
    ),
  },
  {
    icon: PIN,
    text: (
      <>
        <strong className="text-ink">Living near Gatwick</strong> is a plus
        <span className="hidden sm:inline">
          : Crawley, Horley, Redhill, Reigate or Horsham
        </span>
      </>
    ),
  },
];

const PERKS = [
  {
    icon: CALENDAR,
    title: "Pre-booked jobs",
    full: "Journeys are booked ahead, so you see your work before the day. No street hails.",
    short: "See your work before the day.",
  },
  {
    icon: PLANE,
    title: "Live flight timing",
    full: "Airport pickups follow the flight. If it's delayed, the pickup time moves and the app tells you.",
    short: "Pickups move with the flight.",
  },
  {
    icon: PHONE,
    title: "One driver app",
    full: "Job offers, trip details, navigation and your earnings, all in the OrangeRide Driver app.",
    short: "Jobs and earnings in one app.",
  },
  {
    icon: PIN,
    title: "Local and small",
    full: "A Crawley-based team around Gatwick. You talk to the person running it, not a call centre.",
    short: "Crawley-based. Talk to a real person.",
  },
];

const STEPS = [
  {
    title: "Apply",
    full: "Fill in the short application form with your details, licence and car.",
    short: "Fill in the short form.",
  },
  {
    title: "We get in touch",
    full: "We call you for a chat and check your PCO licence, vehicle licence and insurance.",
    short: "We call you and check your documents.",
  },
  {
    title: "Start in the app",
    full: "Download the OrangeRide Driver app, upload your documents and start taking jobs.",
    short: "Get the Driver app and start taking jobs.",
  },
];

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Do I have to drive a Tesla?",
    a: "No. A Tesla is preferred, but we're happy to hear from you if your car is under 7 years old, PHV-licensed and insured for hire and reward.",
  },
  {
    q: "Where is the work?",
    a: "Mostly Gatwick airport transfers to and from Crawley, Horley and nearby towns, plus some journeys to London.",
  },
  {
    q: "Do I need my own car?",
    a: "Yes. We don't provide cars at the moment.",
  },
  {
    q: "Already accepted?",
    a: (
      <span className="flex flex-col gap-3">
        <span>
          Download the OrangeRide Driver app and sign in with the phone number
          you gave us.
        </span>
        <span className="flex flex-wrap gap-[10px]">
          <a
            href={DRIVER_IOS}
            className="inline-flex min-h-[48px] items-center rounded-[14px] bg-ink px-[18px] font-bold text-white no-underline hover:text-white"
          >
            Driver app · App Store
          </a>
          <a
            href={DRIVER_ANDROID}
            className="inline-flex min-h-[48px] items-center rounded-[14px] bg-ink px-[18px] font-bold text-white no-underline hover:text-white"
          >
            Driver app · Google Play
          </a>
        </span>
      </span>
    ),
  },
];

export default function DriversPage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-site px-6 pb-[72px] pt-8">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] items-center gap-10 rounded-[36px] bg-[#ecf6e4] p-[clamp(24px,5vw,60px)]">
          <div className="flex flex-col gap-[18px]">
            <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-[#2a5e15]">
              DRIVE WITH US
            </span>
            <h1 className="m-0 font-heading text-[clamp(40px,5.2vw,68px)] font-bold leading-none tracking-[-0.04em] text-ink">
              Got a PCO licence? Drive with OrangeRide.
            </h1>
            <p className="m-0 max-w-[560px] text-[19px] text-soft">
              <PhoneText
                full="Planned, pre-booked airport work around Gatwick, with live flight timing on every pickup. Fill in a short application and we'll be in touch."
                short="Pre-booked airport work around Gatwick. Apply in a few minutes."
              />
            </p>
            <div className="mt-[6px] flex flex-wrap gap-[10px]">
              <a
                href={DRIVER_APPLY_URL}
                className="inline-flex min-h-[56px] items-center gap-[10px] rounded-[16px] bg-ink px-[26px] text-[17px] font-extrabold text-white no-underline hover:text-white"
              >
                Apply to drive
                <ArrowIcon color="#ffffff" />
              </a>
              <a
                href={WHATSAPP_HREF}
                data-tap="driver_question"
                className="inline-flex min-h-[56px] items-center rounded-[16px] bg-white px-6 text-[17px] font-bold text-ink no-underline hover:text-ink"
              >
                <PhoneText
                  full="Ask a question on WhatsApp"
                  short="WhatsApp us"
                />
              </a>
            </div>
          </div>
          <div className="flex flex-col gap-4 rounded-[28px] bg-white p-[clamp(22px,3vw,34px)] shadow-[0_24px_50px_-30px_rgba(42,94,21,0.45)]">
            <h2 className="m-0 font-heading text-[26px] font-bold tracking-[-0.025em] text-ink">
              What you need
            </h2>
            <ul className="m-0 flex list-none flex-col gap-[14px] p-0 text-[16.5px] text-soft">
              {NEEDS.map((n, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-px">
                    <Icon d={n.icon} size={22} color="#2a5e15" width={2.4} />
                  </span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Why drive with us */}
      <section className="mx-auto flex max-w-site flex-col gap-7 px-6 pb-[88px]">
        <div className="flex max-w-[720px] flex-col gap-[10px]">
          <span className={eyebrow}>WHY DRIVE WITH US</span>
          <h2 className={h2}>Work you can plan around.</h2>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
          {PERKS.map((p) => (
            <div
              key={p.title}
              className="flex flex-col gap-[10px] rounded-[24px] border border-line bg-white p-[26px]"
            >
              <Icon d={p.icon} />
              <h3 className={h3}>{p.title}</h3>
              <p className="m-0">
                <PhoneText full={p.full} short={p.short} />
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-site px-6 pb-[88px]">
        <div className="flex flex-col gap-7 rounded-[36px] border border-line bg-white p-[clamp(24px,4vw,52px)]">
          <div className="flex flex-col gap-[10px]">
            <span className={eyebrow}>HOW IT WORKS</span>
            <h2 className={h2}>From application to first job</h2>
          </div>
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4 p-0">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="flex flex-col gap-[10px] rounded-[24px] bg-[#f8fafc] p-6"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-amber text-[19px] font-extrabold text-ink">
                  {i + 1}
                </span>
                <h3 className={h3}>{s.title}</h3>
                <p className="m-0">
                  <PhoneText full={s.full} short={s.short} />
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Driver FAQs */}
      <section className="mx-auto grid max-w-site grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] items-start gap-8 px-6 pb-[88px]">
        <div className="flex flex-col gap-[10px]">
          <span className={eyebrow}>DRIVER FAQS</span>
          <h2 className={h2}>Questions before you apply</h2>
          <p className="m-0 text-[17px]">
            Something else?{" "}
            <a
              href={WHATSAPP_HREF}
              data-tap="driver_question"
              className="font-bold"
            >
              Message us on WhatsApp
            </a>{" "}
            or call{" "}
            <a
              href={PHONE_HREF}
              data-tap="driver_question"
              className="font-bold"
            >
              {PHONE_DISPLAY}
            </a>
            .
          </p>
        </div>
        <div className="flex flex-col gap-[10px]">
          {FAQS.map((f) => (
            <details
              key={f.q}
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

      {/* Closing band */}
      <section className="mx-auto max-w-site px-6 pb-[104px]">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-[36px] bg-ink p-[clamp(28px,5vw,56px)]">
          <div className="flex max-w-[640px] flex-col gap-2">
            <h2 className="m-0 font-heading text-[clamp(30px,3.6vw,44px)] font-bold leading-[1.04] tracking-[-0.035em] text-white">
              Ready to drive with us?
            </h2>
            <p className="m-0 text-[18px] text-[#d1d5db]">
              <PhoneText
                full="It takes a few minutes. We'll come back to you by phone."
                short="It takes a few minutes."
              />
            </p>
          </div>
          <a
            href={DRIVER_APPLY_URL}
            className="inline-flex min-h-[56px] items-center gap-[10px] rounded-[16px] bg-amber px-7 text-[17px] font-extrabold text-ink no-underline hover:text-ink"
          >
            Apply to drive
            <ArrowIcon color="#2e3238" />
          </a>
        </div>
      </section>
    </>
  );
}
