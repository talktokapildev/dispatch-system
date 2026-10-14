"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  OPEN_CONSENT_EVENT,
  classifyHref,
  isTapKind,
  readConsent,
  saveConsent,
  trackTap,
} from "@/lib/analytics";

/**
 * Cookie consent bar (shown until the visitor chooses) + tap tracking for contact links.
 * Tap tracking listens once at document level, so every WhatsApp / call / email / app link on the
 * site is covered without touching each component.
 */
export default function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (readConsent() === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);

    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href");
      if (!href) return;
      const override = a?.getAttribute("data-tap") ?? undefined;
      const kind = isTapKind(override) ? override : classifyHref(href);
      if (kind) trackTap(kind, href);
    };
    document.addEventListener("click", onClick, { capture: true });

    return () => {
      window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  if (!open) return null;

  const choose = (choice: "granted" | "denied") => {
    saveConsent(choice);
    setOpen(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-[720px] rounded-[20px] bg-ink p-4 text-[15px] text-[#e5e7eb] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.6)] sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <p className="m-0">
          We use cookies to measure how our ads perform.{" "}
          <Link
            href="/privacy#cookies"
            className="font-semibold text-[#fbbf24] hover:text-[#fcd34d]"
          >
            Learn more
          </Link>
        </p>
        <div className="flex shrink-0 gap-[10px]">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] border-2 border-[#5b616a] px-4 font-bold text-white sm:flex-none"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] bg-amber px-5 font-extrabold text-ink sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
