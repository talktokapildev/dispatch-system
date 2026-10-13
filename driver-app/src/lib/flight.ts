// driver-app/src/lib/flight.ts
//
// Phase 2b — flight info for a driver's job.
//   DriverFlight      shape returned by the backend (driverFlightView.ts)
//   useJobDetail(id)  job + flight from GET /drivers/jobs/:id/detail, re-fetched
//                     on "driver:flight_update" (socket), when the app comes to
//                     the front, and every 2 min as a fallback
//   flightToneColor   chip colour for a tone
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { format } from "date-fns";
import { api } from "./api";
import { useSocket } from "./socket";

export type DriverFlight = {
  flightNumber: string;
  airline: string | null;
  origin: string | null;
  state:
    | "SCHEDULED"
    | "TRACKING"
    | "LANDED"
    | "CANCELLED"
    | "DIVERTED"
    | "UNVERIFIED"
    | "ENDED";
  chip: string;
  tone: "neutral" | "info" | "late" | "good" | "bad";
  scheduledLandingAt: string | null;
  takeOffAt: string | null;
  gateAt: string | null;
  gateIsActual: boolean;
  offsetMinutes: number | null;
  pickupAt: string | null;
  bookedPickupAt: string | null;
  lastCheckedAt: string | null;
  flightAwareUrl: string;
  earlierPickup: { earliestAt: string } | null;
  scheduleNotice: { type: string; text: string; at: string } | null;
};

const REFRESH_MS = 2 * 60_000;

export const hm = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "HH:mm") : "—";

export function minutesAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function flightToneColor(
  tone: DriverFlight["tone"],
  C: { muted: string; info: string; warning: string; success: string; danger: string }
): string {
  switch (tone) {
    case "info":
      return C.info;
    case "late":
      return C.warning;
    case "good":
      return C.success;
    case "bad":
      return C.danger;
    default:
      return C.muted;
  }
}

/** Fires `onUpdate` when the backend says this booking's flight changed. */
export function useFlightUpdates(onUpdate: (bookingId: string) => void) {
  const ref = useRef(onUpdate);
  ref.current = onUpdate;
  useSocket({
    "driver:flight_update": (d: any) => {
      if (d?.bookingId) ref.current(d.bookingId);
    },
  });
}

export function useJobDetail(bookingId: string | undefined) {
  const [job, setJob] = useState<any>(null);
  const [flight, setFlight] = useState<DriverFlight | null>(null);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async () => {
    if (!bookingId) return;
    try {
      const { data } = await api.get(`/drivers/jobs/${bookingId}/detail`);
      setJob(data.data.job);
      setFlight(data.data.flight ?? null);
      setNotFound(false);
    } catch (err: any) {
      if (err?.response?.status === 404) setNotFound(true);
    }
  }, [bookingId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  useFlightUpdates((id) => {
    if (id === bookingId) refresh();
  });

  return { job, flight, notFound, refresh };
}
