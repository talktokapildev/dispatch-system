import Image from "next/image";
import Link from "next/link";
import { PHONE_DISPLAY, PHONE_HREF } from "@/lib/site";
import { PhoneIcon } from "./Icons";

const NAV = [
  { href: "/#arrivals", label: "Flight tracking" },
  { href: "/#how", label: "How to book" },
  { href: "/#gatwick", label: "Gatwick" },
  { href: "/#drive", label: "Drive with us" },
  { href: "/#faq", label: "FAQs" },
];

export default function Header() {
  return (
    <header className="mx-auto flex max-w-site flex-wrap items-center justify-between gap-4 px-6 py-[18px]">
      <Link href="/" aria-label="OrangeRide home" className="flex items-center no-underline">
        <Image
          src="/images/logo-wordmark.png"
          alt="OrangeRide"
          width={595}
          height={140}
          priority
          className="block h-[44px] w-auto"
        />
      </Link>
      <nav aria-label="Main" className="flex flex-wrap gap-[2px] text-[15.5px] font-semibold">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex min-h-[44px] items-center px-[14px] py-[10px] text-soft no-underline hover:text-ink"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap gap-[10px]">
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
    </header>
  );
}
