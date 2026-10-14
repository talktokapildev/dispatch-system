import {
  EMAIL_HREF,
  PASSENGER_ANDROID,
  PASSENGER_IOS,
  PHONE_DISPLAY,
  PHONE_HREF,
  WHATSAPP_HREF,
} from "@/lib/site";

const big = "inline-flex min-h-[54px] items-center rounded-[16px] px-[22px] py-[15px] no-underline";
const small = "inline-flex min-h-[48px] items-center rounded-[14px] px-[18px] py-3 font-bold no-underline";

export default function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="mx-auto max-w-site px-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-7 rounded-[36px] bg-ink p-[clamp(24px,5vw,52px)]">
        <div className="flex max-w-[600px] flex-col gap-2">
          <h2
            id="cta-heading"
            className="m-0 font-heading text-[clamp(30px,3.8vw,48px)] font-bold leading-[1.02] tracking-[-0.035em] text-white"
          >
            Flying soon? Let&apos;s get your ride sorted.
          </h2>
          <p className="m-0 text-[18px] text-[#d1d5db]">
            Message or call us, or book in the app at least 24 hours ahead.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <div className="flex flex-wrap gap-[10px]">
            <a href={WHATSAPP_HREF} className={`${big} bg-amber font-extrabold text-ink hover:text-ink`}>
              WhatsApp us
            </a>
            <a
              href={PHONE_HREF}
              className={`${big} border-2 border-[#5b616a] font-bold text-white hover:text-white`}
            >
              Call {PHONE_DISPLAY}
            </a>
          </div>
          <div className="flex flex-wrap gap-[10px]">
            <a href={PASSENGER_IOS} className={`${small} bg-white text-ink hover:text-ink`}>
              App Store
            </a>
            <a href={PASSENGER_ANDROID} className={`${small} bg-white text-ink hover:text-ink`}>
              Google Play
            </a>
            <a
              href={EMAIL_HREF}
              className="inline-flex min-h-[48px] items-center px-1 py-3 font-bold text-[#fbbf24] hover:text-[#fcd34d]"
            >
              Email us
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
