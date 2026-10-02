import { useState, useRef, useEffect } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api } from "../lib/api";
import { addPoints, TracePoint } from "../lib/tripTrace";

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

function toTracePoint(loc: Location.LocationObject): TracePoint {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    timestamp: loc.timestamp,
    accuracy: loc.coords.accuracy,
  };
}

// Define the background task OUTSIDE the component (module level).
// iOS can deliver locations in batches — feed ALL of them to the trip trace
// (so distance/route keep accumulating while backgrounded), and post the
// latest one to the server for Live Dispatch.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error) return;
  const locations: Location.LocationObject[] = (data as any)?.locations ?? [];
  if (!locations.length) return;

  try {
    await addPoints(locations.map(toTracePoint));
  } catch {}

  const latest = locations.reduce((a, b) =>
    b.timestamp > a.timestamp ? b : a
  );
  try {
    await api.post("/drivers/location", {
      latitude: latest.coords.latitude,
      longitude: latest.coords.longitude,
      bearing: Math.max(0, latest.coords.heading ?? 0),
      speed: latest.coords.speed ?? 0,
    });
  } catch {}
});

export function useLocationTracking(
  pollInterval = 8_000,
  enabled = false // only start tracking when driver is online
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
    if (!enabled) return; // do nothing until driver goes online

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
        // Also feed the trip trace (no-op when no trip is active). The
        // background task reports the same movement in the foreground;
        // tripTrace de-duplicates by timestamp and distance.
        addPoints([toTracePoint(loc)]).catch(() => {});
      }
    ).then((sub) => {
      if (!active) {
        // Cleanup already ran before promise resolved — remove immediately
        sub.remove();
      } else {
        watchRef.current = sub;
      }
    });

    return () => {
      active = false;
      watchRef.current?.remove();
      watchRef.current = null;
      // NOTE: the background task is deliberately NOT stopped here. This
      // cleanup also runs when any screen using this hook unmounts (e.g.
      // leaving ActiveJobScreen after a trip), which used to switch off
      // background tracking while the driver was still online.
    };
  }, [enabled]);

  // Stop the background task only on a real online → offline transition.
  // Not on mount with enabled=false: HomeScreen's status can start as
  // OFFLINE while it loads, and stopping then would kill tracking for a
  // driver who is actually online.
  const wasEnabledRef = useRef(enabled);
  useEffect(() => {
    if (wasEnabledRef.current && !enabled) {
      TaskManager.isTaskRegisteredAsync(LOCATION_TASK).then(
        (registered: any) => {
          if (registered) Location.stopLocationUpdatesAsync(LOCATION_TASK);
        }
      );
    }
    wasEnabledRef.current = enabled;
  }, [enabled]);

  return { location, locationRef, getInitialLocation };
}
