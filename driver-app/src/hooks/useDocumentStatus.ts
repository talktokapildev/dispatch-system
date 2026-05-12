// driver-app/src/hooks/useDocumentStatus.ts

import { useState, useEffect, useCallback } from "react";
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

export interface DispatchEligibility {
  eligible: boolean;
  missingDocs: DocType[];
  pendingDocs: DocType[];
  expiredDocs: DocType[];
  rejectedDocs: DocType[];
}

// Human-readable labels for each document type
export const DOC_LABELS: Record<DocType, string> = {
  PCO_LICENSE: "PCO Badge",
  DRIVING_LICENSE: "Driving Licence (Front)",
  DRIVING_LICENSE_BACK: "Driving Licence (Back)",
  PHV_LICENCE: "PHV Licence",
  VEHICLE_INSURANCE: "Vehicle Insurance",
  MOT_CERTIFICATE: "MOT Certificate",
  V5C_LOGBOOK: "V5C Logbook",
  DBS_CHECK: "DBS Certificate",
};

interface UseDocumentStatusResult {
  eligibility: DispatchEligibility | null;
  loading: boolean;
  refresh: () => void;
}

// Poll every 60 seconds while the screen is mounted so the banner
// updates automatically once the admin approves a document.
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
    return () => clearInterval(timer);
  }, [fetch]);

  return { eligibility, loading, refresh: fetch };
}
