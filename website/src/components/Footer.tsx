import Image from "next/image";
import Link from "next/link";
import {
  DRIVER_ANDROID,
  DRIVER_IOS,
  EMAIL,
  EMAIL_HREF,
  PASSENGER_ANDROID,
  PASSENGER_IOS,
  PHONE_DISPLAY,
  PHONE_HREF,
  TFL_LICENCE,
  WHATSAPP_HREF,
} from "@/lib/site";

const link =
  "inline-flex min-h-[44px] items-center self-start text-[#d1d5db] no-underline hover:text-white";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer id="app" className="bg-ink text-[#d1d5db]">
      <div className="mx-auto flex max-w-site flex-col gap-10 px-6 pb-7 pt-14">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-8">
          <div className="flex flex-col gap-[10px]">
            <Image
              src="/images/logo-wordmark-dark.png"
              alt="OrangeRide"
              width={595}
              height={140}
              className="h-[40px] w-[170px] self-start"
            />
            <span className="text-[14.5px]">
              Your private hire, sorted. Pre-booked, fixed-fare journeys for Gatwick, Crawley and
              Horley.
            </span>
          </div>
          <div className="flex flex-col gap-[2px]">
            <strong className="pb-2 text-white">Contact</strong>
            <a href={PHONE_HREF} className={link}>
              Call {PHONE_DISPLAY}
            </a>
            <a href={WHATSAPP_HREF} className={link}>
              WhatsApp
            </a>
            <a href={EMAIL_HREF} className={link}>
              {EMAIL}
            </a>
          </div>
          <div className="flex flex-col gap-[2px]">
            <strong className="pb-2 text-white">Explore</strong>
            <Link href="/#arrivals" className={link}>
              Flight tracking
            </Link>
            <Link href="/#gatwick" className={link}>
              Gatwick transfers
            </Link>
            <Link href="/#drive" className={link}>
              Drive with us
            </Link>
            <a href={DRIVER_IOS} className={link}>
              Driver app (iPhone)
            </a>
            <a href={DRIVER_ANDROID} className={link}>
              Driver app (Android)
            </a>
          </div>
          <div className="flex flex-col gap-[10px]">
            <strong className="text-white">Scan to get the app</strong>
            <div className="flex gap-3">
              <a
                href={PASSENGER_IOS}
                className="flex flex-col items-center gap-[6px] text-[12px] text-[#d1d5db] no-underline hover:text-white"
              >
                <Image
                  src="/images/qr-ios.png"
                  alt="QR code for the OrangeRide app on the App Store"
                  width={92}
                  height={92}
                  className="block h-[92px] w-[92px] rounded-[12px]"
                />
                iPhone
              </a>
              <a
                href={PASSENGER_ANDROID}
                className="flex flex-col items-center gap-[6px] text-[12px] text-[#d1d5db] no-underline hover:text-white"
              >
                <Image
                  src="/images/qr-android.png"
                  alt="QR code for the OrangeRide app on Google Play"
                  width={92}
                  height={92}
                  className="block h-[92px] w-[92px] rounded-[12px]"
                />
                Android
              </a>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-3 border-t border-ink-2 pt-5 text-[13px] text-[#9ca3af]">
          <span>
            © {year} OrangeRide is a trading name of Kapil Dev · TfL private hire operator licence{" "}
            {TFL_LICENCE}
          </span>
          <span className="flex gap-5">
            <Link href="/privacy" className="-my-3 inline-flex min-h-[44px] items-center text-[#9ca3af] hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="-my-3 inline-flex min-h-[44px] items-center text-[#9ca3af] hover:text-white">
              Terms
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
