import type { Metadata } from "next";
import Link from "next/link";
import { WHATSAPP_HREF } from "@/lib/site";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-site flex-col gap-[18px] px-6 pb-24 pt-12">
      <span className="self-start text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
        404
      </span>
      <h1 className="m-0 font-heading text-[clamp(40px,5vw,64px)] font-bold leading-none tracking-[-0.04em] text-ink">
        We can&apos;t find that page.
      </h1>
      <p className="m-0 max-w-[760px] text-pretty text-[19px]">
        It may have moved when we updated our website. Head back to the home page, or message us
        and we&apos;ll help.
      </p>
      <div className="mt-[10px] flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex min-h-[54px] items-center rounded-[16px] bg-amber px-[22px] py-[15px] font-extrabold text-ink no-underline hover:text-ink"
        >
          Go to the home page
        </Link>
        <a
          href={WHATSAPP_HREF}
          className="inline-flex min-h-[54px] items-center rounded-[16px] border-[1.5px] border-[#d1d5db] bg-white px-[22px] py-[15px] font-bold text-ink no-underline hover:text-ink"
        >
          WhatsApp us
        </a>
      </div>
    </section>
  );
}
