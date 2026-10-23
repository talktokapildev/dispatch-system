import Image from "next/image";
import Link from "next/link";
import { NAV } from "@/lib/nav";
import { PHONE_DISPLAY, PHONE_HREF } from "@/lib/site";
import { LiveDot, PhoneIcon } from "./Icons";
import MobileMenu from "./MobileMenu";

/**
 * Desktop (>= 1100px): logo, five links and two buttons in one row, as in the canvas.
 * Below 1100px: logo, a round call button and a Menu button that opens <MobileMenu>.
 */
export default function Header() {
  return (
    <header className="relative mx-auto flex max-w-site flex-nowrap items-center justify-between gap-3 px-6 py-[18px] nav:flex-wrap nav:gap-4">
      <Link href="/" aria-label="OrangeRide home" className="flex min-h-[44px] min-w-0 shrink items-center no-underline">
        <Image
          src="/images/logo-wordmark.png"
          alt="OrangeRide"
          width={595}
          height={140}
          priority
          className="block h-[44px] w-[187px] max-w-full object-contain object-left max-[399px]:h-[34px] max-[399px]:w-[145px]"
        />
      </Link>

      {/* Desktop */}
      <nav aria-label="Main" className="hidden flex-wrap gap-[2px] text-[15.5px] font-semibold nav:flex">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex min-h-[44px] items-center gap-[7px] px-[14px] py-[10px] no-underline hover:text-ink ${
              item.live ? "font-extrabold text-ink" : "text-soft"
            }`}
          >
            {item.live && <LiveDot />}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="hidden flex-wrap gap-[10px] nav:flex">
        <a
          href={PHONE_HREF}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-white px-4 py-[10px] font-bold text-ink no-underline hover:text-ink"
        >
          <PhoneIcon />
          {PHONE_DISPLAY}
        </a>
        <Link
          href="/#app"
          className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 py-[10px] font-bold text-white no-underline hover:text-white"
        >
          Get the app
        </Link>
      </div>

      {/* Phones and tablets */}
      <MobileMenu />
    </header>
  );
}
