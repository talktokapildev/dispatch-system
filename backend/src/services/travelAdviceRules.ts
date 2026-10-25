// backend/src/services/travelAdviceRules.ts
//
// UK government travel advice (FCDO) for the destination on departure flight pages — PURE logic,
// no I/O (tests: scripts/test-passenger-rights.ts). Source: the GOV.UK Content API, Open Government
// Licence v3.0 (credit "Contains public sector information licensed under the Open Government
// Licence v3.0" and link to the advice):
//   index    https://www.gov.uk/api/content/foreign-travel-advice
//            links.children[]: { title, web_url, public_updated_at,
//                                details: { change_description, country: { name, slug, synonyms[] } } }
//   country  https://www.gov.uk/api/content/foreign-travel-advice/<slug>
//            details: { alert_status[], updated_at, reviewed_at, change_description, parts[{ title, slug }] }
// alert_status values (travel-advice-publisher, TravelAdviceEdition::ALERT_STATUSES):
//   avoid_all_but_essential_travel_to_parts, avoid_all_but_essential_travel_to_whole_country,
//   avoid_all_travel_to_parts, avoid_all_travel_to_whole_country

export type AdviceLevel = "NONE" | "PARTS_ESSENTIAL" | "PARTS_ALL" | "WHOLE_ESSENTIAL" | "WHOLE_ALL";
const LEVEL_RANK: Record<AdviceLevel, number> = { NONE: 0, PARTS_ESSENTIAL: 1, PARTS_ALL: 2, WHOLE_ESSENTIAL: 3, WHOLE_ALL: 4 };
const STATUS_LEVEL: Record<string, AdviceLevel> = {
  avoid_all_but_essential_travel_to_parts: "PARTS_ESSENTIAL",
  avoid_all_travel_to_parts: "PARTS_ALL",
  avoid_all_but_essential_travel_to_whole_country: "WHOLE_ESSENTIAL",
  avoid_all_travel_to_whole_country: "WHOLE_ALL",
};

export const ADVICE_BASE = "https://www.gov.uk";
export const INDEX_PATH = "/api/content/foreign-travel-advice";

/** One country in the index. */
export type AdviceCountry = {
  slug: string;
  name: string;
  synonyms: string[];
  changeDescription: string | null;
  updatedAt: string | null; // public_updated_at
  url: string; // https://www.gov.uk/foreign-travel-advice/spain
};

/** One country's advice as the flight pages show it. */
export type TravelAdvice = {
  slug: string;
  name: string;
  level: AdviceLevel;
  updatedAt: string | null; // when the advice last changed
  changeDescription: string | null; // GOV.UK's one-line "latest update"
  url: string;
  entryUrl: string | null; // the "Entry requirements" part, when it has one
};

type Raw = Record<string, any>;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoOrNull = (v: unknown): string | null => {
  const s = text(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
};

/** The index → every country with travel advice (skips withdrawn and malformed entries). */
export function parseIndex(body: unknown): AdviceCountry[] {
  const children: Raw[] = Array.isArray((body as Raw)?.links?.children) ? (body as Raw).links.children : [];
  const out: AdviceCountry[] = [];
  for (const c of children) {
    if (c?.withdrawn === true) continue;
    const slug = text(c?.details?.country?.slug);
    const name = text(c?.details?.country?.name);
    if (!slug || !name || !/^[a-z0-9-]{2,60}$/.test(slug)) continue;
    out.push({
      slug,
      name,
      synonyms: Array.isArray(c?.details?.country?.synonyms) ? c.details.country.synonyms.filter((s: unknown) => typeof s === "string") : [],
      changeDescription: text(c?.details?.change_description),
      updatedAt: isoOrNull(c?.public_updated_at),
      url: `${ADVICE_BASE}/foreign-travel-advice/${slug}`,
    });
  }
  return out;
}

/** The strongest "avoid travel" level in an alert_status list. */
export function levelOf(alertStatus: unknown): AdviceLevel {
  let best: AdviceLevel = "NONE";
  for (const s of Array.isArray(alertStatus) ? alertStatus : []) {
    const l = STATUS_LEVEL[String(s)];
    if (l && LEVEL_RANK[l] > LEVEL_RANK[best]) best = l;
  }
  return best;
}

/** One country's content item (+ its index entry for name/url) → TravelAdvice. */
export function parseCountry(body: unknown, c: AdviceCountry): TravelAdvice {
  const d: Raw = (body as Raw)?.details ?? {};
  const parts: Raw[] = Array.isArray(d.parts) ? d.parts : [];
  const entry = parts.find((p) => text(p?.slug) === "entry-requirements");
  return {
    slug: c.slug,
    name: c.name,
    level: levelOf(d.alert_status),
    updatedAt: isoOrNull(d.updated_at) ?? isoOrNull((body as Raw)?.public_updated_at) ?? c.updatedAt,
    changeDescription: text(d.change_description) ?? c.changeDescription,
    url: c.url,
    entryUrl: entry ? `${c.url}/entry-requirements` : null,
  };
}

// No FCDO advice for the UK itself or the Crown Dependencies.
const NO_ADVICE = new Set(["GB", "UK", "JE", "GG", "IM"]);
// Where the English country name doesn't match GOV.UK's name or synonyms.
const CODE_SLUG: Record<string, string> = { US: "usa", TR: "turkey", HK: "hong-kong", MO: "macao", KR: "south-korea", CV: "cape-verde" };

/** Letters only, accents off, "&"/"Saint" spelt the GOV.UK way: "St. Lucia" → "stlucia". */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z]/g, "");
}

let regionNames: Intl.DisplayNames | null | undefined;
function englishName(code: string): string | null {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    const n = regionNames?.of(code);
    return n && n !== code ? n : null;
  } catch {
    return null;
  }
}

/** ISO 3166 alpha-2 (from the flight data) → GOV.UK country, or null (UK, unknown, no advice). */
export function countryForCode(code: string | null | undefined, index: AdviceCountry[]): AdviceCountry | null {
  const cc = (code ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || NO_ADVICE.has(cc)) return null;
  const slug = CODE_SLUG[cc];
  if (slug) return index.find((c) => c.slug === slug) ?? null;
  const name = englishName(cc);
  if (!name) return null;
  const n = normName(name);
  return (
    index.find((c) => normName(c.name) === n || normName(c.slug) === n) ??
    index.find((c) => c.synonyms.some((s) => normName(s) === n)) ??
    null
  );
}
