import { PASSENGER_ANDROID, PASSENGER_IOS } from "@/lib/site";

const badge =
  "inline-flex min-h-[52px] flex-col justify-center rounded-[14px] bg-ink px-[18px] py-2 leading-[1.15] text-white no-underline hover:text-white";

/** The two dark "Download on the App Store / Get it on Google Play" badges for the passenger app. */
export default function StoreBadges() {
  return (
    <>
      <a href={PASSENGER_IOS} className={badge}>
        <span className="text-[11px] text-[#d1d5db]">Download on the</span>
        <strong className="text-[17px]">App Store</strong>
      </a>
      <a href={PASSENGER_ANDROID} className={badge}>
        <span className="text-[11px] text-[#d1d5db]">Get it on</span>
        <strong className="text-[17px]">Google Play</strong>
      </a>
    </>
  );
}
