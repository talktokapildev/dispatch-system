import { PhoneText } from "../Responsive";
import { DRIVER_ANDROID, DRIVER_IOS, WHATSAPP_HREF } from "@/lib/site";

const btn =
  "inline-flex min-h-[52px] items-center rounded-[16px] py-[15px] font-bold no-underline";

export default function DriveWithUs() {
  return (
    <section id="drive" className="mx-auto max-w-site px-6 pb-[104px]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-center gap-9 rounded-[36px] bg-[#ecf6e4] p-[clamp(24px,5vw,52px)]">
        <div className="flex flex-col gap-[14px]">
          <span className="text-[13.5px] font-extrabold tracking-[0.08em] text-[#2a5e15]">
            DRIVE WITH US
          </span>
          <h2 className="m-0 font-heading text-[clamp(30px,3.6vw,44px)] font-bold leading-[1.04] tracking-[-0.035em] text-ink">
            Got a PCO licence? Grow with us.
          </h2>
          <p className="m-0 text-[17px] text-soft">
            <PhoneText
              full="We're adding drivers as bookings grow. Download the OrangeRide Driver app to apply and upload your documents, or message us first with any questions."
              short="We're adding drivers. Apply in the OrangeRide Driver app."
            />
          </p>
        </div>
        <div className="flex flex-col items-start gap-4">
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0 font-semibold text-ink">
            <li>Planned, pre-booked work</li>
            <li>Live flight timing on airport pickups</li>
            <li>Job offers and earnings in one app</li>
          </ul>
          <div className="flex flex-wrap gap-[10px]">
            <a href={DRIVER_IOS} className={`${btn} bg-ink px-5 text-white hover:text-white`}>
              Driver app · App Store
            </a>
            <a href={DRIVER_ANDROID} className={`${btn} bg-ink px-5 text-white hover:text-white`}>
              Driver app · Google Play
            </a>
            <a href={WHATSAPP_HREF} className={`${btn} bg-white px-[22px] text-ink hover:text-ink`}>
              WhatsApp us
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
