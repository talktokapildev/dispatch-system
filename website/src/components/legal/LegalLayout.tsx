import Link from "next/link";
import type { ReactNode } from "react";
import { EMAIL_HREF, TFL_LICENCE, WHATSAPP_HREF } from "@/lib/site";

export type LegalSection = { id: string; title: string; body: ReactNode };

type Props = {
  title: string;
  intro: string;
  updated: string;
  other: { href: string; label: string };
  summary: { title: string; text: string }[];
  sections: LegalSection[];
};

/** Shared layout for /privacy and /terms: title band, summary cards, "On this page", article. */
export default function LegalLayout({ title, intro, updated, other, summary, sections }: Props) {
  return (
    <>
      <section className="mx-auto flex max-w-site flex-col gap-[18px] px-6 pb-10 pt-12">
        <span className="self-start text-[13.5px] font-extrabold tracking-[0.08em] text-accent-dark">
          LEGAL
        </span>
        <h1 className="m-0 font-heading text-[clamp(40px,5vw,64px)] font-bold leading-none tracking-[-0.04em] text-ink">
          {title}
        </h1>
        <p className="m-0 max-w-[760px] text-pretty text-[19px]">{intro}</p>
        <div className="flex flex-wrap gap-x-[18px] gap-y-2 text-[14.5px] font-semibold text-soft">
          <span>Last updated {updated}</span>
          <span className="text-[#9ca3af]" aria-hidden>
            ·
          </span>
          <span>TfL operator licence {TFL_LICENCE}</span>
          <span className="text-[#9ca3af]" aria-hidden>
            ·
          </span>
          <Link href={other.href} className="text-accent-dark">
            {other.label}
          </Link>
        </div>
        <div className="mt-[10px] grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
          {summary.map((s) => (
            <div
              key={s.title}
              className="flex flex-col gap-1 rounded-[20px] border border-line bg-white px-5 py-[18px]"
            >
              <strong className="text-[15px] text-ink">{s.title}</strong>
              <span className="text-[15px] leading-[1.5]">{s.text}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-site flex-wrap items-start gap-10 px-6 pb-24">
        <nav
          aria-label="On this page"
          className="box-content max-w-[320px] flex-[1_1_260px] rounded-[22px] border border-line bg-white px-3 py-[18px]"
        >
          <span className="block px-3 pb-2 text-[13px] font-extrabold tracking-[0.08em] text-muted">
            ON THIS PAGE
          </span>
          <ol className="m-0 flex list-none flex-col gap-[2px] p-0">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block rounded-[10px] px-3 py-[7px] text-[15px] font-semibold text-soft no-underline hover:bg-page hover:text-ink"
                >
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="legal box-content min-w-0 max-w-[820px] flex-[999_1_560px] rounded-[28px] border border-line bg-white p-[clamp(24px,4vw,48px)] text-[17px] leading-[1.7] text-body">
          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              className="mb-7 border-b border-line pb-7 pt-2"
            >
              <h2 className="mb-[14px] mt-0 font-heading text-[28px] font-bold tracking-[-0.025em] text-ink">
                {i + 1}. {s.title}
              </h2>
              {s.body}
            </section>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-[18px] border border-line bg-[#f8fafc] px-5 py-[18px]">
            <span className="text-[16px]">
              <strong className="text-ink">Questions about this page?</strong> We&apos;re happy to
              help.
            </span>
            <span className="flex flex-wrap gap-[10px]">
              <a
                href={WHATSAPP_HREF}
                className="inline-flex min-h-[44px] items-center rounded-[12px] bg-amber px-4 py-[10px] font-extrabold text-ink no-underline hover:text-ink"
              >
                WhatsApp
              </a>
              <a
                href={EMAIL_HREF}
                className="inline-flex min-h-[44px] items-center rounded-[12px] bg-page px-4 py-[10px] font-bold text-ink no-underline hover:text-ink"
              >
                Email
              </a>
            </span>
          </div>
        </article>
      </section>
    </>
  );
}
