"use client";

import { OPEN_CONSENT_EVENT } from "@/lib/analytics";

/** Footer link that reopens the cookie banner, so visitors can change their choice at any time. */
export default function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}
      className={className}
    >
      Cookie settings
    </button>
  );
}
