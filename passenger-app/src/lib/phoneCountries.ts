// Countries passengers can sign in from (must match the backend's OTP_ALLOWED_COUNTRIES default).
import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type PhoneCountry = { code: CountryCode; name: string; dial: string; flag: string };

const NAMES: [CountryCode, string][] = [
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["QA", "Qatar"],
  ["KW", "Kuwait"],
  ["BH", "Bahrain"],
  ["OM", "Oman"],
  ["US", "United States"],
  ["CA", "Canada"],
  ["IN", "India"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["LU", "Luxembourg"],
  ["PT", "Portugal"],
  ["AT", "Austria"],
  ["CH", "Switzerland"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["PL", "Poland"],
  ["CZ", "Czechia"],
  ["GR", "Greece"],
  ["RO", "Romania"],
  ["HU", "Hungary"],
  ["MT", "Malta"],
  ["CY", "Cyprus"],
];

const flagOf = (code: string) =>
  String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export const PHONE_COUNTRIES: PhoneCountry[] = NAMES.map(([code, name]) => ({
  code,
  name,
  dial: `+${getCountryCallingCode(code)}`,
  flag: flagOf(code),
}));

const BY_CODE = new Map(PHONE_COUNTRIES.map((c) => [c.code as string, c]));
export const findCountry = (code?: string | null) =>
  (code && BY_CODE.get(code.toUpperCase())) || undefined;

const LAST_COUNTRY_KEY = "orangeride.lastPhoneCountry";

/** Default country: last one used on this phone → phone's region setting → UK. */
export async function defaultPhoneCountry(): Promise<PhoneCountry> {
  try {
    const last = findCountry(await AsyncStorage.getItem(LAST_COUNTRY_KEY));
    if (last) return last;
  } catch {}
  try {
    const region = findCountry(getLocales()[0]?.regionCode);
    if (region) return region;
  } catch {}
  return BY_CODE.get("GB")!;
}

export async function rememberPhoneCountry(code: string) {
  try {
    await AsyncStorage.setItem(LAST_COUNTRY_KEY, code);
  } catch {}
}

/**
 * Turn what the person typed into E.164. A number starting with "+" (or "00") wins over the
 * selected country, so pasting "+966 56…" just works. Returns null if it isn't a valid number.
 */
export function toE164(country: PhoneCountry, typed: string): { e164: string; country?: string } | null {
  const t = typed.trim().replace(/^00/, "+");
  const p = t.startsWith("+")
    ? parsePhoneNumberFromString(t)
    : parsePhoneNumberFromString(t, country.code);
  if (!p || !p.isValid()) return null;
  return { e164: p.number, country: p.country };
}

/** Pretty display, e.g. "+966 56 598 8098". */
export function formatInternational(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

