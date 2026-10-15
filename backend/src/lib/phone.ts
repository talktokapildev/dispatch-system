// backend/src/lib/phone.ts
//
// Phone number parsing for sign-in and bookings (libphonenumber-js, full metadata).
//
// - normalizePhone: any reasonable input ("07398 341839", "+966 56 598 8098") → E.164 + country.
// - Sign-in codes go only to mobile numbers (FIXED_LINE_OR_MOBILE is accepted for countries like
//   the US/Canada where the two can't be told apart) and only to allowed countries, as a guard
//   against SMS-pumping fraud. The same allowlist should be ticked in Twilio → Messaging →
//   Settings → Geo permissions.
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type ParsedPhone = { e164: string; country: string | undefined; isMobile: boolean };

/** Default allowlist: UK & Ireland, Europe, Gulf, US/Canada, India. Override with OTP_ALLOWED_COUNTRIES. */
const DEFAULT_OTP_COUNTRIES = [
  "GB", "IE",
  // Europe
  "FR", "DE", "ES", "IT", "NL", "BE", "LU", "PT", "AT", "CH", "SE", "NO", "DK", "FI",
  "PL", "CZ", "GR", "RO", "HU", "MT", "CY",
  // Gulf
  "AE", "SA", "QA", "KW", "BH", "OM",
  // North America, India
  "US", "CA", "IN",
];

export function otpAllowedCountries(): Set<string> {
  const env = process.env.OTP_ALLOWED_COUNTRIES;
  const list = env
    ? env.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_OTP_COUNTRIES;
  return new Set(list);
}

/** Parse to E.164. UK national format (07…) is assumed when no "+" is given. Null if invalid. */
export function normalizePhone(input: unknown): ParsedPhone | null {
  if (!input) return null;
  const cleaned = String(input).trim().replace(/^00/, "+");
  const p = parsePhoneNumberFromString(cleaned, "GB");
  if (!p || !p.isValid()) return null;
  const type = p.getType();
  return {
    e164: p.number,
    country: p.country,
    isMobile: type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE",
  };
}
