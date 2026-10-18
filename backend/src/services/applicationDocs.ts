// backend/src/services/applicationDocs.ts
//
// DriverApplication keeps its documents in doc* columns (storage references, or legacy public
// URLs until they are moved). Anything sent to a browser/app goes through linkApplicationDocs,
// which swaps them for short-lived links.
import type { fileLinker } from "./fileLinks";

export const APP_DOC_SINGLE = [
  "docPcoBadge",
  "docDrivingLicFront",
  "docDrivingLicBack",
  "docPhvLicence",
  "docMot",
  "docDbs",
] as const;
export const APP_DOC_MULTI = ["docInsurance", "docV5c"] as const;
export const APP_DOC_FIELDS = [...APP_DOC_SINGLE, ...APP_DOC_MULTI] as const;

type Files = ReturnType<typeof fileLinker>;

/** Copy of `app` with every doc* field present replaced by links (other fields untouched). */
export function linkApplicationDocs<T extends Record<string, any>>(files: Files, appId: string, app: T): T {
  const out: Record<string, any> = { ...app };
  for (const f of APP_DOC_SINGLE) {
    if (f in out) out[f] = files.link(out[f] as string | null, `app:${appId}:${f}`);
  }
  for (const f of APP_DOC_MULTI) {
    if (f in out) out[f] = files.list(out[f] as string[] | null, `app:${appId}:${f}`);
  }
  return out as T;
}
