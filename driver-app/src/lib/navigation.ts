// driver-app/src/lib/navigation.ts
//
// Phase 2b — open the right screen when a push is tapped.
// Flight pushes carry { type: "FLIGHT_…", bookingId } → JobDetail for that job
// (unless the driver is already on that job's ActiveJob screen, which shows
// the live flight line itself). A tap that arrives before navigation is ready
// (cold start) is kept and replayed from NavigationContainer onReady.
import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef<any>();

let pending: Record<string, any> | null = null;

export function openFromNotification(data: Record<string, any> | undefined) {
  if (!data) return;
  const type = String(data.type ?? "");
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

/** Called from NavigationContainer onReady / when the main stack mounts. */
export function flushPendingNotification() {
  if (!pending) return;
  const data = pending;
  pending = null;
  openFromNotification(data);
}
