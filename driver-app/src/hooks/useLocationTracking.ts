import { useState, useRef, useEffect } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api } from "../lib/api";

const LOCATION_TASK = "background-location-task";

interface Coords {
  latitude: number;
  longitude: number;
}

interface UseLocationTrackingResult {
  location: Coords | null;
  locationRef: React.MutableRefObject<Coords | null>;
  getInitialLocation: () => Promise<Coords | null>;
}

// Define the background task OUTSIDE the component (module level)
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error) return;
  const [loc] = (data as any).locations;
  try {
    await api.post("/drivers/location", {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      bearing: Math.max(0, loc.coords.heading ?? 0),
      speed: loc.coords.speed ?? 0,
    });
  } catch {}
});

export function useLocationTracking(
  pollInterval = 8_000,
  enabled = false // ← NEW: only start tracking when driver is online
): UseLocationTrackingResult {
  const [location, setLocation] = useState<Coords | null>(null);
  const locationRef = useRef<Coords | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  const updateLocation = (coords: Coords) => {
    locationRef.current = coords;
    setLocation(coords);
  };

  const getInitialLocation = async (): Promise<Coords | null> => {
    try {
      // Step 1: foreground permission first (required before asking background)
      const { status: fgStatus } =
        await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== "granted") return null;

      // Step 2: background permission (triggers "Always" prompt on iOS)
      const { status: bgStatus } =
        await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== "granted") {
        console.warn(
          "Background location not granted — tracking will stop when app is backgrounded"
        );
      }

      // Step 3: get current position
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      updateLocation(coords);

      // Step 4: start background location task
      const isRegistered = await TaskManager.isTaskRegisteredAsync(
        LOCATION_TASK
      );
      if (!isRegistered) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: pollInterval,
          distanceInterval: 10,
          foregroundService: {
            notificationTitle: "OrangeRide Driver",
            notificationBody: "Location tracking active",
            notificationColor: "#F97316",
          },
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
        });
      }

      return coords;
    } catch (e) {
      console.error("getInitialLocation error:", e);
      return null;
    }
  };

  // Foreground watcher — only runs when driver is online (enabled = true).
  // Previously this ran unconditionally on mount, which caused Android to
  // prompt for location permission before the disclosure was shown → rejected.
  useEffect(() => {
    if (!enabled) return; // ← do nothing until driver goes online

    let active = true;

    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: pollInterval,
        distanceInterval: 10,
      },
      (loc) => {
        if (!active) return;
        updateLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    ).then((sub) => {
      watchRef.current = sub;
    });

    return () => {
      active = false;
      watchRef.current?.remove();
      watchRef.current = null;
      // Stop background task when driver goes offline
      TaskManager.isTaskRegisteredAsync(LOCATION_TASK).then(
        (registered: any) => {
          if (registered) Location.stopLocationUpdatesAsync(LOCATION_TASK);
        }
      );
    };
  }, [enabled]); // ← re-runs when driver toggles online/offline

  return { location, locationRef, getInitialLocation };
}
