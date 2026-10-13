// driver-app/src/lib/jobs.ts
//
// Shared job-board helpers:
//   getCoordsQuietly()  driver's location for distance tags — never shows our
//                       own alert (the OS prompt only appears if never asked)
//   legText(leg)        "2.1 mi · 6 min"
//   claimJob(job)       claim with the same checks + messages everywhere
//                       (job board card and job detail screen)
import { Alert } from "react-native";
import * as Location from "expo-location";
import { api } from "./api";

export type Leg = { miles: number; minutes: number };
export type JobDistance = { toPickup: Leg | null; trip: Leg | null };

export function legText(leg: Leg | null | undefined): string | null {
  if (!leg) return null;
  const miles = leg.miles < 10 ? leg.miles.toFixed(1) : Math.round(leg.miles);
  const mins =
    leg.minutes < 60
      ? `${leg.minutes} min`
      : `${Math.floor(leg.minutes / 60)}h ${leg.minutes % 60}m`;
  return `${miles} mi · ${mins}`;
}

/** Actual trip (completed jobs): miles + minutes as stored on the booking. */
export function actualTripText(job: {
  actualDistance?: number | null;
  actualDuration?: number | null;
}): string | null {
  if (job.actualDistance == null || job.actualDuration == null) return null;
  // Nothing recorded (e.g. completed without moving) → show nothing.
  if (job.actualDistance <= 0.05) return null;
  return legText({
    miles: Math.round(job.actualDistance * 10) / 10,
    minutes: Math.round(job.actualDuration),
  });
}

export async function getCoordsQuietly(): Promise<{
  lat: number;
  lng: number;
} | null> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status === "undetermined")
      status = (await Location.requestForegroundPermissionsAsync()).status;
    if (status !== "granted") return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    const pos =
      last ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

/** Query params for list/detail requests (empty when location unknown). */
export async function coordsParams(): Promise<Record<string, number>> {
  const c = await getCoordsQuietly();
  return c ? { lat: c.lat, lng: c.lng } : {};
}

/**
 * Claim a job board job. Returns "claimed", "gone" (someone else has it) or
 * "failed". Shows the outcome alert itself.
 */
export async function claimJob(jobId: string): Promise<"claimed" | "gone" | "failed"> {
  let coords: { latitude: number; longitude: number } | null = null;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Location needed",
        "Your location is used to check you can reach pickup in time."
      );
      return "failed";
    }
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  } catch {
    Alert.alert("Location needed", "Couldn't get your location - please try again.");
    return "failed";
  }

  try {
    await api.post(`/bookings/${jobId}/claim`, coords);
    return "claimed";
  } catch (err: any) {
    const reason = err.response?.data?.error;
    const messages: Record<string, string> = {
      already_claimed: "Another driver just claimed this job.",
      eta_infeasible:
        "You wouldn't be able to reach pickup in time from your current location.",
      lock_contended: "This job is being claimed right now — try again.",
    };
    Alert.alert("Couldn't claim job", messages[reason] ?? "Please try again.");
    return reason === "already_claimed" ? "gone" : "failed";
  }
}
