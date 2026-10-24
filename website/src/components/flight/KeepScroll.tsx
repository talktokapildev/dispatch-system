"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, type ReactNode } from "react";

// Arrivals (/flight-status) and departures (/flight-status/departures) are separate pages, so
// switching between them rebuilds the page and the browser would jump back near the top. These
// keep the visitor exactly where they were, as when both lived on one page.

const KEY = "orangeride-flight-scroll";
// Layout effect in the browser (runs before paint, so no visible jump); plain effect on the server.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A board tab: remembers the scroll position for the page it opens. */
export function KeepScrollLink({
  href,
  className,
  current,
  children,
}: {
  href: string;
  className: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={current ? "page" : undefined}
      className={className}
      onClick={() => {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ y: window.scrollY, to: href, at: Date.now() }));
        } catch {
          /* storage unavailable: the page just opens at the top */
        }
      }}
    >
      {children}
    </Link>
  );
}

/** On the page a tab opened: put the scroll position back before it's painted. */
export function KeepScrollRestore() {
  useBeforePaint(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      sessionStorage.removeItem(KEY);
      const { y, to, at } = JSON.parse(raw) as { y: number; to: string; at: number };
      if (Date.now() - at > 10_000 || to !== window.location.pathname + window.location.search) return;
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
    } catch {
      /* ignore */
    }
  }, []);
  return null;
}
