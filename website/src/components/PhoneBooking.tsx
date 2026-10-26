import { PhoneIcon } from "./Icons";
import { PHONE_DISPLAY, PHONE_HREF } from "@/lib/site";

/**
 * "Prefer to talk?" line under the price checker: booking by phone, no app needed.
 * For customers who'd rather speak to a person (many of our travellers are older).
 */
export default function PhoneBooking() {
  return (
    <p className="m-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 pb-2 text-center text-[16px] text-body sm:pb-0">
      <span>Prefer to talk to someone? Call us and we&apos;ll book it for you, no app needed:</span>
      <a
        href={PHONE_HREF}
        className="inline-flex min-h-[44px] items-center gap-2 font-extrabold text-ink"
      >
        <PhoneIcon size={16} />
        {PHONE_DISPLAY}
      </a>
    </p>
  );
}
