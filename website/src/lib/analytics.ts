// Google Ads measurement. All IDs here are public (they're sent to every visitor's browser).

export const GOOGLE_TAG_ID = "AW-18358557171";

/** Conversion labels from Google Ads → Goals → Conversions → (action) → See event snippet. */
export const CONVERSIONS = {
  /** "Submit lead form" (Website contact tap): WhatsApp, email and passenger-app store taps. */
  contact: "ryxiCPvVz9gcEPOzhbJE",
  /** "Website call tap": taps on the phone number. Empty until the action exists; falls back to `contact`. */
  call: "",
};

/** localStorage key holding the visitor's cookie choice: "granted" | "denied". */
export const CONSENT_KEY = "orangeride-cookie-consent";

/** Event fired on window when the visitor wants to reopen the cookie banner (footer "Cookie settings"). */
export const OPEN_CONSENT_EVENT = "orangeride:open-cookie-settings";

type Gtag = (...args: unknown[]) => void;

function gtag(...args: unknown[]) {
  const w = window as unknown as { gtag?: Gtag };
  w.gtag?.(...args);
}

export function readConsent(): "granted" | "denied" | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function saveConsent(choice: "granted" | "denied") {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Storage unavailable (private mode etc.): choice applies to this visit only.
  }
  gtag("consent", "update", {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
  });
}

export type TapKind = "whatsapp" | "call" | "email" | "app_store" | "driver_app";

/** What a link is, judged by its href. */
export function classifyHref(href: string): TapKind | null {
  if (href.startsWith("tel:")) return "call";
  if (href.startsWith("mailto:")) return "email";
  if (href.includes("wa.me/")) return "whatsapp";
  if (href.includes("orangeride-driver") || href.includes("com.orangeride.driver")) return "driver_app";
  if (href.includes("apps.apple.com") || href.includes("play.google.com")) return "app_store";
  return null;
}

/** Record a tap. Contact taps count as Google Ads conversions; driver-app taps are tracked only. */
export function trackTap(kind: TapKind, href: string) {
  gtag("event", "contact_tap", { method: kind, link_url: href });
  if (kind === "driver_app") return;
  const label = kind === "call" ? CONVERSIONS.call || CONVERSIONS.contact : CONVERSIONS.contact;
  gtag("event", "conversion", { send_to: `${GOOGLE_TAG_ID}/${label}`, method: kind });
}
