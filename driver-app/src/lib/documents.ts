// driver-app/src/lib/documents.ts
//
// Document upload + shared helpers.
// - Every upload is a new version that waits for review; the approved copy stays in force until
//   it expires, so uploading a renewal early never stops the driver working.
// - Expiry date is required for PCO badge, PHV vehicle licence, insurance and MOT
//   (the admin checks it when approving).
// - Insurance and V5C can have several pages (max 6).
import { Alert } from "react-native";
import { format } from "date-fns";
import { api } from "./api";
import type { DocType } from "../hooks/useDocumentStatus";

export const EXPIRY_REQUIRED = new Set<DocType>([
  "PCO_LICENSE",
  "PHV_LICENCE",
  "VEHICLE_INSURANCE",
  "MOT_CERTIFICATE",
]);
export const MULTI_PAGE = new Set<DocType>(["VEHICLE_INSURANCE", "V5C_LOGBOOK"]);
export const MAX_PAGES = 6;

export const DOC_ICONS: Record<DocType, string> = {
  PCO_LICENSE: "🪪",
  DRIVING_LICENSE: "🚗",
  DRIVING_LICENSE_BACK: "🚗",
  DBS_CHECK: "✅",
  PHV_LICENCE: "📄",
  VEHICLE_INSURANCE: "🛡️",
  MOT_CERTIFICATE: "🔧",
  V5C_LOGBOOK: "📋",
};

/** A page picked from the camera, photos or files. */
export interface PickedPage {
  uri: string;
  name: string;
  mimeType: string;
  isPdf: boolean;
}

/** "18 May 2027" from the server's date (midnight UTC of the expiry day). */
export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "";
  return format(new Date(iso.slice(0, 10) + "T12:00:00"), "dd MMM yyyy");
}

/** Send a new version for review. Throws with the server's message on failure. */
export async function uploadDocument(
  type: DocType,
  pages: PickedPage[],
  expiry: Date | null
): Promise<void> {
  const form = new FormData();
  form.append("type", type);
  if (expiry) form.append("expiryDate", format(expiry, "yyyy-MM-dd"));
  pages.forEach((p, i) =>
    form.append("file", {
      uri: p.uri,
      name: p.name || `${type.toLowerCase()}_${i + 1}.${p.isPdf ? "pdf" : "jpg"}`,
      type: p.mimeType,
    } as any)
  );
  await api.post("/drivers/documents", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120_000,
  });
}

/** Server said documents stop this action: show why, with a way to Documents. */
export function showDocumentsBlocked(
  navigation: any,
  message: string,
  title = "Documents need attention"
) {
  Alert.alert(title, message || "Please check your documents.", [
    { text: "Later", style: "cancel" },
    { text: "Open Documents", onPress: () => navigation.navigate("Documents") },
  ]);
}

/** true when an API error is the server's "documents" block. */
export const isDocumentsError = (err: any) =>
  err?.response?.status === 403 &&
  (err.response?.data?.reason === "documents" ||
    err.response?.data?.error === "documents");
