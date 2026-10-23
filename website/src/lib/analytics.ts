// Google Ads measurement. All IDs here are public (they're sent to every visitor's browser).

export const GOOGLE_TAG_ID = "AW-18358557171";

/** Conversion labels from Google Ads → Goals → Conversions → (action) → See event snippet. */
export const CONVERSIONS = {
  /** "Submit lead form" (Website contact tap): WhatsApp, email and passenger-app store taps. */
  contact: "ryxiCPvVz9gcEPOzhbJE",
  /** "Website call tap" (Contact goal): taps on the phone number. Falls back to `contact` if emptied. */
  call: "JjmMCOrX6ZwdEPOzhbJE",
  /** "Driver application click" (Sign-up goal, Campaign #1 only): taps on Apply (the Google Form). */
  driverApply: "eVgnCK2G95wdEPOzhbJE",
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

export type TapKind =
  | "whatsapp"
  | "call"
  | "email"
  | "app_store"
  | "driver_app"
  | "driver_apply"
  | "driver_question"
  | "quote_whatsapp";

/** Links can override how they're counted with data-tap="<kind>" (e.g. WhatsApp on the driver page). */
export function isTapKind(v: string | undefined): v is TapKind {
  return (
    v === "whatsapp" ||
    v === "call" ||
    v === "email" ||
    v === "app_store" ||
    v === "driver_app" ||
    v === "driver_apply" ||
    v === "driver_question" ||
    v === "quote_whatsapp"
  );
}

/** What a link is, judged by its href. */
export function classifyHref(href: string): TapKind | null {
  if (href.startsWith("tel:")) return "call";
  if (href.startsWith("mailto:")) return "email";
  if (href.includes("docs.google.com/forms") || href.includes("forms.gle/"))
    return "driver_apply";
  if (href.includes("wa.me/")) return "whatsapp";
  if (
    href.includes("orangeride-driver") ||
    href.includes("com.orangeride.driver")
  )
    return "driver_app";
  if (href.includes("apps.apple.com") || href.includes("play.google.com"))
    return "app_store";
  return null;
}

/**
 * A price was shown by the quote calculator (status QUOTED / OUT_OF_AREA / BUSY / ERROR).
 * Reported as an event only — NOT a Google Ads conversion. The conversion is the
 * "Book this on WhatsApp" tap that may follow (data-tap="quote_whatsapp").
 */
export function trackQuoteShown(status: string, fromPrice?: number) {
  gtag("event", "quote_shown", {
    quote_status: status,
    ...(fromPrice !== undefined ? { value: fromPrice, currency: "GBP" } : {}),
  });
}

/**
 * Record a tap. Passenger contact taps count as Google Ads conversions; Apply-to-drive taps count as
 * the separate driver conversion (once its label is set); driver-app taps and driver questions
 * (WhatsApp/call from the driver page) are tracked only, so they don't count as passenger leads.
 */
export function trackTap(kind: TapKind, href: string) {
  gtag("event", "contact_tap", { method: kind, link_url: href });
  if (kind === "driver_app" || kind === "driver_question") return;
  if (kind === "driver_apply") {
    if (CONVERSIONS.driverApply) {
      gtag("event", "conversion", {
        send_to: `${GOOGLE_TAG_ID}/${CONVERSIONS.driverApply}`,
        method: kind,
      });
    }
    return;
  }
  const label =
    kind === "call"
      ? CONVERSIONS.call || CONVERSIONS.contact
      : CONVERSIONS.contact;
  gtag("event", "conversion", {
    send_to: `${GOOGLE_TAG_ID}/${label}`,
    method: kind,
  });
}
