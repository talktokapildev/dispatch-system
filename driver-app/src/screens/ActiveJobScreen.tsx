import React, { useState, useEffect } from "react";
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

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_COLLAPSED = 140;
const SHEET_EXPANDED = SCREEN_HEIGHT * 0.55;

// Statuses where driver can still cancel
const CANCELLABLE_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
];

export default function ActiveJobScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
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

  const { location, locationRef, getInitialLocation } = useLocationTracking();
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
    const s = getSocket();
    if (!s) return;

    const handleCancelled = (data: any) => {
      if (data.bookingId === bookingId) {
        Alert.alert(
          "Booking Cancelled",
          "The passenger has cancelled this booking.",
          [
            {
              text: "OK",
              onPress: () =>
                navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
            },
          ]
        );
      }
    };

    s.on("booking:cancelled", handleCancelled);
    return () => {
      s.off("booking:cancelled", handleCancelled);
    };
  }, [bookingId]);

  const initScreen = async () => {
    let coords = locationRef.current ?? preloadedLocation ?? null;
    if (!coords) coords = await getInitialLocation();

    if (!booking) {
      try {
        const { data } = await api.get(`/bookings/${bookingId}`);
        const bookingData = data.data;
        setBooking(bookingData);
        if (coords) fetchRoute(coords, bookingData);
      } catch {
        Alert.alert("Error", "Could not load booking");
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(false);
      if (routeCoords.length === 0 && coords) fetchRoute(coords, booking);
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
      await api.patch(`/drivers/jobs/${bookingId}/status`, { status });
      if (status === "COMPLETED") {
        navigation.reset({
          index: 0,
          routes: [{ name: "JobComplete", params: { booking } }],
        });
      } else {
        const { data } = await api.get(`/bookings/${bookingId}`);
        const bookingData = data.data;
        setBooking(bookingData);
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
      await api.post(`/drivers/jobs/${bookingId}/cancel`, { reason });
      Alert.alert(
        "Job Cancelled",
        "The passenger has been notified. You're now back online.",
        [
          {
            text: "OK",
            onPress: () =>
              navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
          },
        ]
      );
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
    const googleUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
    const appleUrl = `maps://?daddr=${lat},${lng}`;
    Linking.canOpenURL(googleUrl).then((s) =>
      Linking.openURL(s ? googleUrl : appleUrl).catch(() =>
        Linking.openURL(
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
        )
      )
    );
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
