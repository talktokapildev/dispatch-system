import { EMAIL, EMAIL_HREF, PHONE_DISPLAY, PHONE_HREF, TFL_LICENCE, WHATSAPP_HREF } from "@/lib/site";
import { ChatIcon, PhoneIcon } from "../Icons";
import { PhoneText } from "../Responsive";
import StoreBadges from "../StoreBadges";
import HeroPhone from "./HeroPhone";

const POINTS = ["Fixed fares", "Pre-booked, 24 hours ahead", "Live tracking for arriving flights"];

export default function Hero() {
  return (
    <section
      id="top"
      className="mx-auto grid max-w-site grid-cols-[repeat(auto-fit,minmax(min(520px,100%),1fr))] items-center gap-14 px-6 pb-10 pt-8 sm:pb-16 sm:pt-10"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-line bg-white py-[6px] pl-[6px] pr-[14px] text-[14px] font-semibold text-soft">
          <span className="whitespace-nowrap rounded-full bg-ink px-[10px] py-[3px] text-[12.5px] font-bold text-white">
            TfL {TFL_LICENCE}
          </span>
          <PhoneText
            full="Licensed private hire, 10 minutes from Gatwick"
            short={
              <>
                <span className="max-[359px]:hidden">Licensed · </span>10 min from Gatwick
              </>
            }
          />
        </span>
        <h1 className="m-0 text-balance font-heading text-[clamp(42px,5.6vw,76px)] font-bold leading-[0.98] tracking-[-0.04em] text-ink">
          Gatwick transfers, <span className="text-accent">planned to the minute.</span>
        </h1>
        <p className="m-0 max-w-[540px] text-pretty text-[19px]">
          <PhoneText
            full={
              <>
                Fixed-fare private hire from Crawley, Horley and the Gatwick area, with London and
                Heathrow transfers too. Book a day or more ahead. If you&apos;re flying in, add your
                flight in the app and we&apos;ll time your pickup to your landing.
              </>
            }
            short="Fixed-fare rides for Gatwick, London and Heathrow, with pickups timed to your landing."
          />
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href="#quote"
            className="inline-flex min-h-[56px] items-center justify-center gap-[10px] rounded-[16px] bg-amber px-6 py-[15px] text-[17px] font-extrabold max-sm:w-full max-sm:whitespace-nowrap max-sm:px-4 text-ink no-underline hover:text-ink"
          >
            Get a price
          </a>
          <a
            href={WHATSAPP_HREF}
            className="inline-flex min-h-[56px] items-center justify-center gap-[10px] rounded-[16px] border-[1.5px] border-[#d1d5db] bg-white px-[22px] py-[15px] text-[17px] font-bold max-sm:flex-auto max-sm:whitespace-nowrap max-sm:px-4 text-ink no-underline hover:text-ink"
          >
            <ChatIcon />
            WhatsApp us
          </a>
          <a
            href={PHONE_HREF}
            aria-label={`Call ${PHONE_DISPLAY}`}
            className="inline-flex min-h-[56px] items-center justify-center gap-[10px] rounded-[16px] border-[1.5px] border-[#d1d5db] bg-white px-[22px] py-[15px] text-[17px] font-bold text-ink no-underline hover:text-ink max-sm:flex-auto max-sm:whitespace-nowrap max-sm:px-4"
          >
            <PhoneIcon size={18} />
            <PhoneText full={`Call ${PHONE_DISPLAY}`} short="Call us" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StoreBadges />
          <a
            href={EMAIL_HREF}
            className="inline-flex min-h-[44px] items-center px-1 py-[10px] font-semibold text-body"
          >
            or email {EMAIL}
          </a>
        </div>
        <ul className="m-0 hidden list-none flex-wrap gap-x-[22px] gap-y-2 p-0 text-[14.5px] font-semibold text-soft sm:flex">
          {POINTS.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className="h-[7px] w-[7px] rounded-full bg-amber" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* Phones: skip the mock-up so the quote form follows the hero (the flight section shows the app). */}
      <div className="hidden min-w-0 sm:block">
        <HeroPhone />
      </div>
    </section>
  );
}
