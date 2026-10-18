// driver-app/src/lib/navigation.ts
//
// Phase 2b — open the right screen when a push is tapped.
// Flight pushes carry { type: "FLIGHT_…", bookingId } → JobDetail for that job.
// Document pushes ({ type: "DOCUMENT_…" }) → Documents (job removed → Home).
// (unless the driver is already on that job's ActiveJob screen, which shows
// the live flight line itself). A tap that arrives before navigation is ready
// (cold start) is kept and replayed from NavigationContainer onReady.
import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef<any>();

let pending: Record<string, any> | null = null;

export function openFromNotification(data: Record<string, any> | undefined) {
  if (!data) return;
  const type = String(data.type ?? "");
  if (type.startsWith("DOCUMENT_")) {
    openDocumentPush(data, type);
    return;
  }
  const bookingId = data.bookingId as string | undefined;
  if (!type.startsWith("FLIGHT_") || !bookingId) return;

  if (!navigationRef.isReady()) {
    pending = data;
    return;
  }
  const state = navigationRef.getRootState();
  if (!state?.routeNames?.includes("JobDetail")) {
    pending = data; // logged out / disclosure screen — try after login
    return;
  }
  const current = navigationRef.getCurrentRoute();
  if (
    (current?.name === "ActiveJob" || current?.name === "JobDetail") &&
    (current.params as any)?.bookingId === bookingId
  )
    return;
  if (current?.name === "JobDetail" && (current.params as any)?.job?.id === bookingId)
    return;
  navigationRef.navigate("JobDetail", { bookingId });
}

/**
 * Document pushes (expiring, expired, approved, rejected, set offline) → Documents.
 * "Job taken off you" (DOCUMENT_JOB_REMOVED) → Home.
 */
function openDocumentPush(data: Record<string, any>, type: string) {
  if (!navigationRef.isReady()) {
    pending = data;
    return;
  }
  const state = navigationRef.getRootState();
  if (!state?.routeNames?.includes("Documents")) {
    pending = data; // logged out / disclosure screen — try after login
    return;
  }
  const current = navigationRef.getCurrentRoute()?.name;
  // Never pull the driver out of a trip or a job offer
  if (current === "ActiveJob" || current === "JobOffer" || current === "JobComplete") return;
  if (type === "DOCUMENT_JOB_REMOVED") {
    navigationRef.navigate("Main", { screen: "Home" });
    return;
  }
  if (current === "Documents") return;
  navigationRef.navigate("Documents");
}

/** Called from NavigationContainer onReady / when the main stack mounts. */
export function flushPendingNotification() {
  if (!pending) return;
  const data = pending;
  pending = null;
  openFromNotification(data);
}
