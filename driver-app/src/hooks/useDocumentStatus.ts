// driver-app/src/hooks/useDocumentStatus.ts
//
// The driver's document status from GET /driver/dispatch-eligibility. The server decides
// everything (backend documentRules.ts): which documents are needed — the driver's own and
// their current car's — and whether each is valid, expiring, waiting for review, rejected,
// expired or missing. The app only displays it.
//
// Refreshes every 60 s while mounted, when the app comes to the front, and on refresh().

import { useState, useEffect, useCallback } from "react";
import { AppState } from "react-native";
import { api } from "../lib/api";

export type DocType =
  | "PCO_LICENSE"
  | "DRIVING_LICENSE"
  | "DRIVING_LICENSE_BACK"
  | "PHV_LICENCE"
  | "VEHICLE_INSURANCE"
  | "MOT_CERTIFICATE"
  | "V5C_LOGBOOK"
  | "DBS_CHECK";

export type DocState =
  | "valid"
  | "missing"
  | "pending"
  | "rejected"
  | "expired"
  | "expiry_needed";

export interface DocItem {
  type: DocType;
  label: string;
  owner: "driver" | "vehicle";
  state: DocState;
  expiryDate: string | null;
  daysLeft: number | null;
  /** A newer upload is waiting for review. */
  pendingReview: boolean;
  /** Reason the newest upload was rejected (if it was). */
  rejectionReason: string | null;
}

export interface DispatchEligibility {
  eligible: boolean;
  /** false = not enforced yet on the server (jobs still come). */
  enforced?: boolean;
  /** One line for the driver: why they can't take jobs. Empty when eligible. */
  message?: string;
  noVehicle?: boolean;
  vehicle?: { id: string; licensePlate: string } | null;
  items?: DocItem[];
  problems?: DocItem[];
  expiringSoon?: DocItem[];
  // Older fields (kept by the server)
  missingDocs: DocType[];
  pendingDocs: DocType[];
  expiredDocs: DocType[];
  rejectedDocs: DocType[];
}

// Labels for the older fields (the server sends labels with items)
export const DOC_LABELS: Record<DocType, string> = {
  PCO_LICENSE: "PCO badge",
  DRIVING_LICENSE: "Driving licence (front)",
  DRIVING_LICENSE_BACK: "Driving licence (back)",
  PHV_LICENCE: "PHV vehicle licence",
  VEHICLE_INSURANCE: "Insurance",
  MOT_CERTIFICATE: "MOT",
  V5C_LOGBOOK: "V5C logbook",
  DBS_CHECK: "DBS certificate",
};

interface UseDocumentStatusResult {
  eligibility: DispatchEligibility | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 60_000;

export function useDocumentStatus(): UseDocumentStatusResult {
  const [eligibility, setEligibility] = useState<DispatchEligibility | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const res = await api.get<DispatchEligibility>(
        "/driver/dispatch-eligibility"
      );
      setEligibility(res.data);
    } catch (err) {
      // Fail silently — the banner simply won't render if eligibility is null
      console.warn("[useDocumentStatus] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const timer = setInterval(fetch, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") fetch();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [fetch]);

  return { eligibility, loading, refresh: fetch };
}
