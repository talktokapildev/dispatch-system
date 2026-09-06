import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
  ScrollView,
  ActivityIndicator,
  Animated,
  Dimensions,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { isHeadingToPickup } from "../lib/mapUtils";
import { useLocationTracking } from "../hooks/useLocationTracking";
import { useJobRoute } from "../hooks/useJobRoute";
import { useBottomSheet } from "../hooks/useBottomSheet";
import {
  getNextStep,
  getCurrentStepIndex,
  JOB_STEPS,
} from "../components/JobStepProgress";
import TripMap from "../components/TripMap";
import JobStepProgress from "../components/JobStepProgress";
import AddressCard from "../components/AddressCard";
import PassengerCard from "../components/PassengerCard";
import { getSocket } from "../lib/socket";
import { blockBookingDispatch } from "../lib/dispatchFlags";
import { useTeslaNavigation } from "../hooks/useTeslaNavigation";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_COLLAPSED = 185; // tall enough to show cancel button without expanding
const SHEET_EXPANDED = SCREEN_HEIGHT * 0.55;

// Statuses where driver can still cancel
const CANCELLABLE_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
];

// ── Dev-only tools flag ─────────────────────────────────────────────────────
// True only in development and preview EAS builds (see eas.json) — never in
// production or android-apk. Lets us simulate trip distance for fare/wallet
// testing without physically driving.
const DEV_TOOLS_ENABLED = process.env.EXPO_PUBLIC_DEV_TOOLS === "true";

export default function ActiveJobScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { sendToTesla } = useTeslaNavigation();
  const {
    bookingId,
    preloadedBooking,
    preloadedRouteCoords,
    preloadedLocation,
  } = route.params;

  const [booking, setBooking] = useState<any>(preloadedBooking ?? null);
  const [loading, setLoading] = useState(!preloadedBooking);
  const [updating, setUpdating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [teslaEligible, setTeslaEligible] = useState(false);

  const { location, locationRef, getInitialLocation } = useLocationTracking(
    8_000,
    true
  );
  // Prevents spurious "Booking Cancelled" alerts after driver self-cancels
  const cancelledByDriver = useRef(false);
  // Prevents both socket AND polling from each showing the cancellation alert
  const cancellationHandled = useRef(false);

  // ── Distance accumulator for dynamic fare ──────────────────────────────
  const tripDistanceMilesRef = useRef<number>(0);
  const tripStartedAtRef = useRef<Date | null>(null);
  const lastTripLocationRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // ── Dev-only: mirrors tripDistanceMilesRef for display purposes only.
  // The ref itself remains the single source of truth read at completion —
  // this state exists purely so the driver can see the accumulated value
  // on screen while testing.
  const [devSimulatedMiles, setDevSimulatedMiles] = useState(0);

  const addSimulatedMiles = (miles: number) => {
    tripDistanceMilesRef.current += miles;
    setDevSimulatedMiles(tripDistanceMilesRef.current);
  };

  const resetSimulatedMiles = () => {
    tripDistanceMilesRef.current = 0;
    setDevSimulatedMiles(0);
  };

  // Shows an alert immediately if app is active, or waits until foregrounded.
  // Prevents the iOS native nav bar artifact that appears when an Alert fires
  // during the background→foreground transition.
  const showWhenActive = (title: string, message: string, onOk: () => void) => {
    const fire = () =>
      Alert.alert(title, message, [{ text: "OK", onPress: onOk }]);
    if (AppState.currentState === "active") {
      fire();
    } else {
      const sub = AppState.addEventListener("change", (state: string) => {
        if (state === "active") {
          sub.remove();
          fire();
        }
      });
    }
  };
  const { routeCoords, fetchRoute } = useJobRoute(preloadedRouteCoords ?? []);
  const {
    sheetHeight,
    isExpanded,
    expandSheet,
    collapseSheet,
    toggleSheet,
    panResponder,
  } = useBottomSheet(SHEET_COLLAPSED, SHEET_EXPANDED);

  useEffect(() => {
    if (preloadedLocation && !locationRef.current) {
      locationRef.current = preloadedLocation;
    }
  }, []);

  useEffect(() => {
    initScreen();
  }, []);

  useEffect(() => {
    if (booking && locationRef.current)
      fetchRoute(locationRef.current, booking);
  }, [booking?.status]);

  useEffect(() => {
    api
      .get("/driver/tesla/status")
      .then(({ data }) => {
        setTeslaEligible(
          !!data.connected &&
            !!data.integration?.enabled &&
            !!data.integration?.vehicleId
        );
      })
      .catch(() => setTeslaEligible(false));
  }, []);

  // Track last coords used for route fetch — avoid refetching on tiny movements
  const lastRouteFetchRef = useRef<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // ── Accumulate trip distance during IN_PROGRESS ─────────────────────────
  useEffect(() => {
    if (!location || booking?.status !== "IN_PROGRESS") return;
    if (lastTripLocationRef.current) {
      const d = haversineMiles(lastTripLocationRef.current, location);
      tripDistanceMilesRef.current += d;
      setDevSimulatedMiles(tripDistanceMilesRef.current);
    }
    lastTripLocationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (!location || !booking) return;
    // Only refetch if driver has moved more than ~50m since last route fetch
    if (lastRouteFetchRef.current) {
      const dlat = Math.abs(
        location.latitude - lastRouteFetchRef.current.latitude
      );
      const dlng = Math.abs(
        location.longitude - lastRouteFetchRef.current.longitude
      );
      if (dlat < 0.00045 && dlng < 0.00045) return; // ~50m threshold
    }
    lastRouteFetchRef.current = location;
    fetchRoute(location, booking);
  }, [location]);

  useEffect(() => {
    // ── Socket listener with retry (mirrors JobOfferScreen pattern) ──────────
    // If socket isn't ready on first mount (e.g. still reconnecting after
    // navigation), retry once after 1 s so the listener is always attached.
    const handleCancelled = (data: any) => {
      if (
        data.bookingId === bookingId &&
        !cancelledByDriver.current &&
        !cancellationHandled.current
      ) {
        cancellationHandled.current = true;
        showWhenActive(
          "Booking Cancelled",
          "The passenger has cancelled this booking.",
          () => navigation.reset({ index: 0, routes: [{ name: "Main" }] })
        );
      }
    };

    const attach = () => {
      const s = getSocket();
      if (!s) return null;
      s.on("booking:cancelled", handleCancelled);
      return () => s.off("booking:cancelled", handleCancelled);
    };

    const cleanup = attach();
    if (cleanup) return cleanup;

    // Socket not ready yet — retry after 1 s
    const retryTimer = setTimeout(() => attach(), 1000);
    return () => clearTimeout(retryTimer);
  }, [bookingId]);

  useEffect(() => {
    // ── Polling fallback ─────────────────────────────────────────────────────
    // Guards against missed socket events (phone backgrounded, brief disconnect).
    // Every 20 s, fetch booking status; if CANCELLED, show alert and go home.
    const pollTimer = setInterval(async () => {
      try {
        const { data } = await api.get(`/bookings/${bookingId}`);
        if (
          data?.data?.status === "CANCELLED" &&
          !cancelledByDriver.current &&
          !cancellationHandled.current
        ) {
          cancellationHandled.current = true;
          clearInterval(pollTimer);
          showWhenActive(
            "Booking Cancelled",
            "The passenger has cancelled this booking.",
            () => navigation.reset({ index: 0, routes: [{ name: "Main" }] })
          );
        }
      } catch {}
    }, 20_000);

    return () => clearInterval(pollTimer);
  }, [bookingId]);

  const initScreen = async () => {
    let coords = locationRef.current ?? preloadedLocation ?? null;
    if (!coords) {
      coords = await getInitialLocation();
    } else {
      // HomeScreen unmounts on navigation.reset, stopping the background task.
      // Restart it here — getInitialLocation is idempotent (checks isRegistered).
      getInitialLocation().catch(() => {});
    }

    // Always fetch fresh booking status — preloadedBooking is fetched in
    // JobOfferScreen BEFORE the driver accepts, so its status is stale
    // (PENDING/CONFIRMED). Without a fresh fetch, canCancel is always false
    // and the cancel button never appears.
    try {
      const { data } = await api.get(`/bookings/${bookingId}`);
      const bookingData = data.data;
      setBooking(bookingData);
      if (coords) fetchRoute(coords, bookingData);
    } catch {
      // If fetch fails, fall back to preloaded data for route only
      if (!booking) Alert.alert("Error", "Could not load booking");
      else if (coords && routeCoords.length === 0) fetchRoute(coords, booking);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (status === "COMPLETED") {
      Alert.alert("Complete Trip?", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        { text: "Complete", onPress: () => doUpdate(status) },
      ]);
      return;
    }
    await doUpdate(status);
  };

  const doUpdate = async (status: string) => {
    setUpdating(true);
    try {
      // Record trip start time and reset accumulator when trip begins
      if (status === "IN_PROGRESS") {
        tripStartedAtRef.current = new Date();
        tripDistanceMilesRef.current = 0;
        lastTripLocationRef.current = locationRef.current;
        setDevSimulatedMiles(0);
      }

      // Build completion payload with actual distance/duration if available
      const body: Record<string, any> = { status };
      if (status === "COMPLETED" && tripStartedAtRef.current) {
        const durationMins = Math.round(
          (Date.now() - tripStartedAtRef.current.getTime()) / 60000
        );
        body.actualDistance = parseFloat(
          tripDistanceMilesRef.current.toFixed(2)
        );
        body.actualDuration = durationMins;
      }

      const { data: statusRes } = await api.patch(
        `/drivers/jobs/${bookingId}/status`,
        body
      );
      if (status === "COMPLETED") {
        // replace() keeps [Main] below so JobComplete can popToTop() cleanly
        navigation.replace("JobComplete", {
          booking: { ...booking, ...statusRes.data },
        });
      } else {
        const { data } = await api.get(`/bookings/${bookingId}`);
        const bookingData = data.data;
        setBooking(bookingData);

        // Send dropoff to Tesla when passenger is picked up (fire and forget)
        if (
          status === "IN_PROGRESS" &&
          bookingData.dropoffLatitude &&
          bookingData.dropoffLongitude
        ) {
          sendToTesla(
            bookingData.dropoffLatitude,
            bookingData.dropoffLongitude,
            bookingData.dropoffAddress
          );
        }

        if (locationRef.current) fetchRoute(locationRef.current, bookingData);
        collapseSheet();
      }
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Failed to update status"
      );
    } finally {
      setUpdating(false);
    }
  };

  // ── Driver cancellation ───────────────────────────────────────────────────
  const handleCancel = () => {
    Alert.alert(
      "Cancel Job?",
      "Are you sure you want to cancel this job? The passenger will be notified and we'll try to find them another driver.",
      [
        { text: "No, keep job", style: "cancel" },
        {
          text: "Yes, cancel job",
          style: "destructive",
          onPress: showCancelReasons,
        },
      ]
    );
  };

  const showCancelReasons = () => {
    const reasons = [
      "Vehicle breakdown",
      "Road closure / traffic",
      "Personal emergency",
      "Passenger not at pickup",
      "Other",
    ];
    Alert.alert("Reason for cancelling", "Please select a reason:", [
      ...reasons.map((reason) => ({
        text: reason,
        onPress: () => doCancel(reason),
      })),
      { text: "Back", style: "cancel" },
    ]);
  };

  const doCancel = async (reason: string) => {
    setCancelling(true);
    try {
      cancelledByDriver.current = true; // prevents spurious alerts after self-cancel
      // Block re-dispatch of this booking for 30 s — backend may immediately
      // re-dispatch the same job to us after we're freed as available.
      blockBookingDispatch(bookingId);
      await api.post(`/drivers/jobs/${bookingId}/cancel`, { reason });
      navigation.reset({ index: 0, routes: [{ name: "Main" }] }); // navigate home immediately — no secondary alert
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error ?? "Failed to cancel job");
    } finally {
      setCancelling(false);
    }
  };

  const openNavigation = () => {
    if (!booking) return;
    const toPickup =
      isHeadingToPickup(booking.status) && booking.status !== "DRIVER_ARRIVED";
    const lat = toPickup ? booking.pickupLatitude : booking.dropoffLatitude;
    const lng = toPickup ? booking.pickupLongitude : booking.dropoffLongitude;
    if (!lat || !lng) {
      Alert.alert("Navigation Error", "Location coordinates not available.");
      return;
    }

    const options: { label: string; url: string }[] = [];

    const googleUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
    const wazeUrl = `waze://?ll=${lat},${lng}&navigate=yes`;
    const appleUrl = `maps://?daddr=${lat},${lng}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

    const buildOptions = async () => {
      const [hasGoogle, hasWaze, hasApple] = await Promise.all([
        Linking.canOpenURL(googleUrl),
        Linking.canOpenURL(wazeUrl),
        Linking.canOpenURL(appleUrl),
      ]);
      if (hasGoogle) options.push({ label: "Google Maps", url: googleUrl });
      if (hasWaze) options.push({ label: "Waze", url: wazeUrl });
      if (hasApple) options.push({ label: "Apple Maps", url: appleUrl });
      options.push({ label: "Google Maps (browser)", url: webUrl });

      const buttons: {
        text: string;
        onPress?: () => any;
        style?: "default" | "cancel" | "destructive";
      }[] = options.map((o) => ({
        text: o.label,
        onPress: () =>
          Linking.openURL(o.url).catch(() => Linking.openURL(webUrl)),
      }));

      // Only offered when the driver's Tesla is connected, the auto-send
      // toggle is on, and a vehicle is selected — matches the same
      // conditions TeslaSettingsScreen relies on for automatic sends.
      if (teslaEligible) {
        buttons.push({
          text: "🚗 Send to Tesla",
          onPress: () =>
            sendToTesla(
              lat,
              lng,
              toPickup ? booking.pickupAddress : booking.dropoffAddress
            ),
        });
      }

      buttons.push({ text: "Cancel", style: "cancel" as const });

      Alert.alert("Open with", undefined, buttons);
    };

    buildOptions().catch(() => Linking.openURL(webUrl));
  };

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: Colors.bg,
        }}
      >
        <ActivityIndicator color={Colors.brand} size="large" />
      </View>
    );
  }
  if (!booking) return null;

  const driverLoc = location ?? preloadedLocation ?? null;
  const nextStep = getNextStep(booking.status);
  const currentIdx = getCurrentStepIndex(booking.status);
  const currentStep = JOB_STEPS[currentIdx];
  const passenger = booking.passenger?.user;
  const mapStage =
    booking.status === "IN_PROGRESS" ? "to_dropoff" : "to_pickup";
  const canCancel = CANCELLABLE_STATUSES.includes(booking.status);
  const showDevTools = DEV_TOOLS_ENABLED && booking.status === "IN_PROGRESS";
  const s = styles(Colors);

  return (
    <View style={s.container}>
      {/* Map */}
      <TripMap
        style={StyleSheet.absoluteFill}
        driverLocation={driverLoc ?? undefined}
        pickup={{
          latitude: booking.pickupLatitude,
          longitude: booking.pickupLongitude,
        }}
        dropoff={
          booking.status === "IN_PROGRESS"
            ? {
                latitude: booking.dropoffLatitude,
                longitude: booking.dropoffLongitude,
              }
            : undefined
        }
        routeCoords={routeCoords.length > 1 ? routeCoords : undefined}
        stage={mapStage}
        bottomPadding={SHEET_COLLAPSED + 20}
      />

      {routeCoords.length === 0 && (
        <View style={s.mapLoading}>
          <ActivityIndicator color={Colors.brand} size="small" />
          <Text style={s.mapLoadingText}>Loading route…</Text>
        </View>
      )}

      {/* ── DEV ONLY: simulate trip distance for fare testing ────────────── */}
      {showDevTools && (
        <View style={s.devPanel} pointerEvents="box-none">
          <View style={s.devPanelInner}>
            <Text style={s.devPanelTitle}>
              🛠 DEV — Simulated: {devSimulatedMiles.toFixed(1)} mi
            </Text>
            <View style={s.devPanelRow}>
              <TouchableOpacity
                style={s.devBtn}
                onPress={() => addSimulatedMiles(1)}
              >
                <Text style={s.devBtnText}>+1 mi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.devBtn}
                onPress={() => addSimulatedMiles(5)}
              >
                <Text style={s.devBtnText}>+5 mi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.devBtn}
                onPress={() => addSimulatedMiles(10)}
              >
                <Text style={s.devBtnText}>+10 mi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.devBtn, s.devBtnReset]}
                onPress={resetSimulatedMiles}
              >
                <Text style={s.devBtnText}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Bottom sheet */}
      <Animated.View style={[s.sheet, { height: sheetHeight }]}>
        {/* Handle */}
        <TouchableOpacity
          {...panResponder.panHandlers}
          onPress={toggleSheet}
          activeOpacity={1}
          style={s.handleArea}
        >
          <View style={s.handle} />
          <View style={s.stepIndicator}>
            <View
              style={[
                s.stepDot,
                { backgroundColor: currentStep?.color ?? Colors.brand },
              ]}
            />
            <Text style={s.stepLabel}>
              {currentStep?.desc ?? "Job in progress"}
            </Text>
            <Text style={s.swipeHint}>
              {isExpanded.current ? "▼ collapse" : "▲ swipe for details"}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity style={s.navBtn} onPress={openNavigation}>
            <Text style={s.navBtnIcon}>🗺</Text>
            <Text style={s.navBtnText}>Navigate</Text>
          </TouchableOpacity>

          {nextStep && (
            <TouchableOpacity
              style={[
                s.actionBtn,
                { backgroundColor: nextStep.color },
                updating && s.btnDisabled,
              ]}
              onPress={() => updateStatus(nextStep.status)}
              disabled={updating || cancelling}
            >
              {updating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Text style={s.actionBtnIcon}>{nextStep.icon}</Text>
                  <Text style={s.actionBtnText}>{nextStep.label}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Cancel job button — only before trip starts */}
        {canCancel && (
          <View style={s.cancelWrap}>
            <TouchableOpacity
              style={[s.cancelBtn, cancelling && s.btnDisabled]}
              onPress={handleCancel}
              disabled={cancelling || updating}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color={Colors.danger} />
              ) : (
                <Text style={s.cancelBtnText}>⚠ Can't complete this job</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Expanded details */}
        <ScrollView
          style={s.expandedContent}
          showsVerticalScrollIndicator={false}
        >
          <JobStepProgress status={booking.status} />
          <AddressCard
            pickupAddress={booking.pickupAddress}
            dropoffAddress={booking.dropoffAddress}
          />
          {passenger && <PassengerCard passenger={passenger} />}

          <View
            style={[
              s.infoCard,
              { flexDirection: "row", justifyContent: "space-between" },
            ]}
          >
            <Text style={s.infoLabel}>Reference</Text>
            <Text
              style={[
                s.infoValue,
                { color: Colors.brand, fontFamily: "monospace" },
              ]}
            >
              {booking.reference}
            </Text>
          </View>
          <View
            style={[
              s.infoCard,
              { flexDirection: "row", justifyContent: "space-between" },
            ]}
          >
            <Text style={s.infoLabel}>Estimated Fare</Text>
            <Text
              style={[
                s.infoValue,
                {
                  color: Colors.brand,
                  fontWeight: "800",
                  fontSize: FontSize.md,
                },
              ]}
            >
              £{booking.estimatedFare?.toFixed(2)}
            </Text>
          </View>

          {booking.flightNumber && (
            <View
              style={[
                s.infoCard,
                {
                  backgroundColor: Colors.info + "15",
                  borderColor: Colors.info + "30",
                },
              ]}
            >
              <Text style={{ color: Colors.info, fontSize: FontSize.sm }}>
                ✈ Flight {booking.flightNumber} · Terminal {booking.terminal}
              </Text>
            </View>
          )}

          {booking.notes && (
            <View style={s.infoCard}>
              <Text style={s.infoLabel}>Notes</Text>
              <Text
                style={{
                  fontSize: FontSize.sm,
                  color: Colors.text,
                  marginTop: 4,
                }}
              >
                {booking.notes}
              </Text>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// ── Haversine distance in miles between two coordinates ──────────────────
function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    mapLoading: {
      position: "absolute",
      top: "40%",
      alignSelf: "center",
      backgroundColor: C.card + "ee",
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: C.border,
    },
    mapLoadingText: { fontSize: FontSize.sm, color: C.text },
    devPanel: {
      position: "absolute",
      top: 60,
      left: Spacing.md,
      right: Spacing.md,
      alignItems: "center",
    },
    devPanelInner: {
      backgroundColor: "#000000dd",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: "#f59e0b80",
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    devPanelTitle: {
      color: "#f59e0b",
      fontSize: FontSize.xs,
      fontWeight: "700",
      textAlign: "center",
      marginBottom: Spacing.xs,
    },
    devPanelRow: { flexDirection: "row", gap: Spacing.xs },
    devBtn: {
      backgroundColor: "#f59e0b20",
      borderWidth: 1,
      borderColor: "#f59e0b",
      borderRadius: Radius.sm,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    devBtnReset: { backgroundColor: "#ffffff10", borderColor: "#ffffff40" },
    devBtnText: { color: "#f59e0b", fontSize: FontSize.xs, fontWeight: "700" },
    sheet: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      borderTopWidth: 1,
      borderColor: C.border,
      overflow: "hidden",
    },
    handleArea: {
      paddingTop: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
      alignSelf: "center",
      marginBottom: Spacing.sm,
    },
    stepIndicator: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    stepDot: { width: 10, height: 10, borderRadius: 5 },
    stepLabel: {
      flex: 1,
      fontSize: FontSize.sm,
      fontWeight: "600",
      color: C.white,
    },
    swipeHint: { fontSize: FontSize.xs, color: C.muted },
    actions: {
      flexDirection: "row",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.xs,
    },
    navBtn: {
      backgroundColor: C.bg,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    navBtnIcon: { fontSize: 18 },
    navBtnText: { fontSize: FontSize.xs, color: C.text, fontWeight: "600" },
    actionBtn: {
      flex: 1,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: Spacing.sm,
    },
    actionBtnIcon: { fontSize: 18 },
    actionBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    btnDisabled: { opacity: 0.6 },
    // Cancel button — sits between actions and expanded content
    cancelWrap: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
    cancelBtn: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.danger + "50",
      backgroundColor: C.danger + "10",
      paddingVertical: Spacing.sm,
      alignItems: "center",
    },
    cancelBtnText: {
      fontSize: FontSize.xs,
      color: C.danger,
      fontWeight: "700",
    },
    expandedContent: { flex: 1, paddingHorizontal: Spacing.lg },
    infoCard: {
      backgroundColor: C.bg,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    infoLabel: { fontSize: FontSize.xs, color: C.muted },
    infoValue: { fontSize: FontSize.sm, color: C.white, fontWeight: "500" },
  });
