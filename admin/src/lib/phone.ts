// Phone helpers for the admin: country list for the picker and E.164 conversion.
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneCountryOption = { code: CountryCode; label: string };

const names = (() => {
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" });
  } catch {
    return null;
  }
})();

const flag = (code: string) =>
  String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Most-used first, then every other country alphabetically. */
const TOP: CountryCode[] = ["GB", "IE", "AE", "SA", "QA", "US", "IN", "FR", "DE", "ES", "IT"];

export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = (() => {
  const make = (code: CountryCode): PhoneCountryOption => ({
    code,
    label: `${flag(code)} ${names?.of(code) ?? code} (+${getCountryCallingCode(code)})`,
  });
  const rest = getCountries()
    .filter((c) => !TOP.includes(c))
    .map(make)
    .sort((a, b) => a.label.slice(3).localeCompare(b.label.slice(3)));
  return [...TOP.map(make), ...rest];
})();

/**
 * Typed number → E.164 using the chosen country, unless the number already starts with "+"/"00".
 * Returns null when it isn't a valid number.
 */
export function toE164(country: CountryCode, typed: string): { e164: string; pretty: string } | null {
  const t = typed.trim().replace(/^00/, "+");
  if (!t) return null;
  const p = t.startsWith("+") ? parsePhoneNumberFromString(t) : parsePhoneNumberFromString(t, country);
  if (!p || !p.isValid()) return null;
  return { e164: p.number, pretty: p.formatInternational() };
}
