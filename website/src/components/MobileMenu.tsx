"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV } from "@/lib/nav";
import { PHONE_DISPLAY, PHONE_HREF, WHATSAPP_HREF } from "@/lib/site";
import { ChatIcon, LiveDot, PhoneIcon } from "./Icons";

/**
 * Header controls below 1100px: a round call button and a Menu button.
 * Menu drops a panel down under the header with the five links and the main actions.
 * Closes on link tap, the Close button, Escape or a tap outside. Page scroll is locked while open.
 */
export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // Move focus into the menu
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    // Lock page scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
      // Keep Tab inside the menu button + panel
      if (e.key === "Tab" && panelRef.current && buttonRef.current) {
        const items = [
          buttonRef.current,
          ...Array.from(panelRef.current.querySelectorAll<HTMLElement>("a, button")),
        ];
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Close if the screen grows to desktop width
    const mq = window.matchMedia("(min-width: 1100px)");
    const onMq = () => mq.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open, close]);

  return (
    <div className="flex shrink-0 items-center gap-[10px] nav:hidden">
      <a
        href={PHONE_HREF}
        aria-label={`Call ${PHONE_DISPLAY}`}
        className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white no-underline"
      >
        <PhoneIcon size={18} />
      </a>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
        className="relative z-50 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full bg-ink px-[18px] py-[10px] font-bold text-white max-[359px]:px-3"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
        <span className="max-[359px]:sr-only">{open ? "Close" : "Menu"}</span>
      </button>

      {open && (
        <>
          {/* Tap outside to close */}
          <div
            aria-hidden
            onClick={() => close(false)}
            className="fixed inset-0 z-30 bg-[rgba(46,50,56,0.35)]"
          />
          <div
            id="mobile-menu"
            ref={panelRef}
            className="absolute inset-x-4 top-[calc(100%-6px)] z-40 flex max-h-[calc(100vh-110px)] flex-col gap-3 overflow-y-auto rounded-[22px] border border-line bg-white p-3 shadow-[0_24px_50px_-20px_rgba(46,50,56,0.45)]"
          >
            <nav aria-label="Main">
              <ul className="m-0 flex list-none flex-col p-0">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => close(false)}
                      className={`flex min-h-[48px] items-center gap-[9px] rounded-[14px] px-[14px] text-[17px] no-underline hover:bg-page hover:text-ink ${
                        item.live ? "font-extrabold text-ink" : "font-semibold text-soft"
                      }`}
                    >
                      {item.label}
                      {item.live && <LiveDot />}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex flex-col gap-[10px] border-t border-line px-1 pb-1 pt-3">
              <a
                href={WHATSAPP_HREF}
                className="inline-flex min-h-[52px] items-center justify-center gap-[10px] rounded-[16px] bg-amber px-5 font-extrabold text-ink no-underline hover:text-ink"
              >
                <ChatIcon size={18} />
                WhatsApp us
              </a>
              <a
                href={PHONE_HREF}
                className="inline-flex min-h-[52px] items-center justify-center gap-[10px] rounded-[16px] border-[1.5px] border-[#d1d5db] bg-white px-5 font-bold text-ink no-underline hover:text-ink"
              >
                <PhoneIcon size={18} />
                Call {PHONE_DISPLAY}
              </a>
              <Link
                href="/#app"
                onClick={() => close(false)}
                className="inline-flex min-h-[52px] items-center justify-center rounded-[16px] bg-ink px-5 font-bold text-white no-underline hover:text-white"
              >
                Get the app
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
