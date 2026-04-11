import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Animated,
  Dimensions,
} from "react-native";
import { api, useAuthStore } from "../lib/api";
import { getSocket, initSocket } from "../lib/socket";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { decodePolyline } from "../lib/mapUtils";
import TripMap from "../components/TripMap";
import DriverCard from "../components/DriverCard";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_COLLAPSED = 180;
const SHEET_EXPANDED = SCREEN_HEIGHT * 0.52;

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  PENDING: { label: "Finding your driver…", icon: "🔍", color: "#f59e0b" },
  CONFIRMED: { label: "Booking confirmed", icon: "✅", color: "#22c55e" },
  DRIVER_ASSIGNED: { label: "Driver assigned", icon: "🚖", color: "#3b82f6" },
  DRIVER_EN_ROUTE: { label: "Driver on the way", icon: "🚗", color: "#f59e0b" },
  DRIVER_ARRIVED: {
    label: "Driver has arrived!",
    icon: "📍",
    color: "#22c55e",
  },
  IN_PROGRESS: { label: "Trip in progress", icon: "🛣️", color: "#f59e0b" },
  COMPLETED: { label: "Trip completed", icon: "🏁", color: "#22c55e" },
  CANCELLED: { label: "Trip cancelled", icon: "✕", color: "#ef4444" },
};

export default function TrackingScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { token } = useAuthStore();
  const { bookingId, booking: initialBooking } = route.params;

  const [booking, setBooking] = useState<any>(initialBooking ?? null);
  const [driverLocation, setDriverLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [routeCoords, setRouteCoords] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [loading, setLoading] = useState(!initialBooking);
  const [cancelling, setCancelling] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const sheetHeight = useRef(new Animated.Value(SHEET_COLLAPSED)).current;

  const toggleSheet = () => {
    const toValue = isExpanded ? SHEET_COLLAPSED : SHEET_EXPANDED;
    Animated.spring(sheetHeight, { toValue, useNativeDriver: false }).start();
    setIsExpanded(!isExpanded);
  };

  // ── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const socket = initSocket(token);

    // Join the booking room so we receive status/location updates
    socket.emit("join:booking", { bookingId });

    // booking:status_update — emitted by dispatch.service on every status change
    const onStatusUpdate = (data: any) => {
      if (data.bookingId !== bookingId) return;
      setBooking((prev: any) =>
        prev ? { ...prev, status: data.status } : prev
      );

      if (data.status === "COMPLETED") {
        navigation.reset({
          index: 0,
          routes: [{ name: "RideComplete", params: { booking } }],
        });
      }
      if (data.status === "DRIVER_CANCELLED") {
        // Driver cancelled — show message, keep screen open (re-dispatch in progress)
        Alert.alert(
          "Driver Cancelled",
          "Your driver had to cancel. We're finding you a new driver…"
        );
        fetchBooking(); // refresh to get updated status
        return;
      }
      if (data.status === "DRIVER_CANCELLED") {
        Alert.alert(
          "Driver Cancelled",
          "Your driver had to cancel. We're finding you a new driver…"
        );
        fetchBooking();
        return;
      }
      if (data.status === "CANCELLED") {
        Alert.alert("Trip Cancelled", "Your booking has been cancelled.", [
          {
            text: "OK",
            onPress: () =>
              navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
          },
        ]);
      }
    };

    // booking:driver_location — emitted by drivers.ts on location update
    const onDriverLocation = (data: any) => {
      if (data.bookingId !== bookingId) return;
      setDriverLocation({ latitude: data.latitude, longitude: data.longitude });
      fetchRouteFromDriver({
        latitude: data.latitude,
        longitude: data.longitude,
      });
    };

    // passenger:driver_assigned — emitted when a driver accepts the job
    const onDriverAssigned = (data: any) => {
      if (data.bookingId !== bookingId) return;
      fetchBooking();
    };

    socket.on("booking:status_update", onStatusUpdate);
    socket.on("booking:driver_location", onDriverLocation);
    socket.on("passenger:driver_assigned", onDriverAssigned);
    // Also handle the passenger-namespaced versions for forward compat
    socket.on("passenger:status_update", onStatusUpdate);
    socket.on("passenger:driver_location", onDriverLocation);

    return () => {
      socket.off("booking:status_update", onStatusUpdate);
      socket.off("booking:driver_location", onDriverLocation);
      socket.off("passenger:driver_assigned", onDriverAssigned);
      socket.off("passenger:status_update", onStatusUpdate);
      socket.off("passenger:driver_location", onDriverLocation);
    };
  }, [token, bookingId]);

  // ── Poll for updates every 15s (belt-and-braces alongside sockets) ────────
  useEffect(() => {
    fetchBooking();
    const interval = setInterval(fetchBooking, 15_000);
    return () => clearInterval(interval);
  }, []);

  const fetchBooking = async () => {
    try {
      const { data } = await api.get(`/passengers/bookings/${bookingId}`);
      const b = data.data;
      setBooking(b);

      if (b.driver?.lastLatitude) {
        const driverLoc = {
          latitude: b.driver.lastLatitude,
          longitude: b.driver.lastLongitude,
        };
        setDriverLocation(driverLoc);
        fetchRouteFromDriver(driverLoc, b);
      }

      if (b.status === "COMPLETED") {
        navigation.reset({
          index: 0,
          routes: [{ name: "RideComplete", params: { booking: b } }],
        });
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const fetchRouteFromDriver = async (
    driverLoc: { latitude: number; longitude: number },
    b?: any
  ) => {
    const bk = b ?? booking;
    if (!bk) return;
    const isInProgress = bk.status === "IN_PROGRESS";
    const dest = isInProgress
      ? { latitude: bk.dropoffLatitude, longitude: bk.dropoffLongitude }
      : { latitude: bk.pickupLatitude, longitude: bk.pickupLongitude };

    try {
      const { data } = await api.get("/maps/directions", {
        params: {
          originLat: driverLoc.latitude,
          originLng: driverLoc.longitude,
          destLat: dest.latitude,
          destLng: dest.longitude,
        },
      });
      const poly = data.data?.polyline;
      if (poly) setRouteCoords(decodePolyline(poly));
    } catch {}
  };

  const cancelBooking = () => {
    // To:
    const isCancellable = [
      "PENDING",
      "CONFIRMED",
      "DRIVER_ASSIGNED",
      "DRIVER_EN_ROUTE",
      "DRIVER_ARRIVED",
    ].includes(booking?.status);
    if (!isCancellable) {
      Alert.alert(
        "Cannot cancel",
        "Cannot cancel — trip is already in progress."
      );
      return;
    }
    Alert.alert(
      "Cancel Booking?",
      "Are you sure you want to cancel this ride?",
      [
        { text: "No", style: "cancel" },
        { text: "Yes, Cancel", style: "destructive", onPress: doCancel },
      ]
    );
  };

  const doCancel = async () => {
    setCancelling(true);
    try {
      await api.patch(`/passengers/bookings/${bookingId}/cancel`);
      navigation.reset({ index: 0, routes: [{ name: "Main" }] });
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Could not cancel booking"
      );
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={Colors.brand} size="large" />
        <Text
          style={{
            color: Colors.muted,
            marginTop: Spacing.md,
            fontSize: FontSize.sm,
          }}
        >
          Loading your trip…
        </Text>
      </View>
    );
  }

  const status = booking?.status ?? "PENDING";
  const statusInfo = STATUS_CONFIG[status] ?? STATUS_CONFIG["PENDING"];
  const driver = booking?.driver;
  const canCancel = [
    "PENDING",
    "CONFIRMED",
    "DRIVER_ASSIGNED",
    "DRIVER_EN_ROUTE",
    "DRIVER_ARRIVED",
  ].includes(status);
  const s = styles(Colors);

  return (
    <View style={s.container}>
      {/* Full-screen map */}
      <TripMap
        style={StyleSheet.absoluteFill}
        driverLocation={driverLocation ?? undefined}
        pickup={{
          latitude: booking?.pickupLatitude,
          longitude: booking?.pickupLongitude,
        }}
        dropoff={
          status === "IN_PROGRESS"
            ? {
                latitude: booking?.dropoffLatitude,
                longitude: booking?.dropoffLongitude,
              }
            : undefined
        }
        routeCoords={routeCoords.length > 1 ? routeCoords : undefined}
        stage="tracking"
        bottomPadding={SHEET_COLLAPSED + 20}
      />

      {/* Waiting overlay when no driver yet */}
      {status === "PENDING" && (
        <View style={s.waitingOverlay}>
          <ActivityIndicator color={Colors.brand} size="small" />
          <Text style={s.waitingText}>Finding your driver…</Text>
        </View>
      )}

      {/* Bottom sheet */}
      <Animated.View style={[s.sheet, { height: sheetHeight }]}>
        {/* Handle + status */}
        <TouchableOpacity
          style={s.handleArea}
          onPress={toggleSheet}
          activeOpacity={1}
        >
          <View style={s.handle} />
          <View style={s.statusRow}>
            <Text style={s.statusIcon}>{statusInfo.icon}</Text>
            <Text style={[s.statusLabel, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
            <Text style={s.swipeHint}>{isExpanded ? "▼" : "▲"}</Text>
          </View>
        </TouchableOpacity>

        {/* Reference + cancel */}
        <View style={s.refRow}>
          <Text style={s.refLabel}>Ref</Text>
          <Text style={s.refValue}>{booking?.reference}</Text>
          {canCancel && (
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={cancelBooking}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color={Colors.danger} />
              ) : (
                <Text style={s.cancelText}>Cancel ride</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Expanded content */}
        <ScrollView
          style={s.expandedContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Driver card */}
          {driver && (
            <DriverCard
              driver={{
                firstName: driver.user?.firstName,
                lastName: driver.user?.lastName,
                pcoBadgeNumber: driver.pcoBadgeNumber,
                rating: driver.rating,
                vehicle: driver.vehicle,
              }}
            />
          )}

          {!driver && status !== "CANCELLED" && (
            <View style={s.noDriverCard}>
              <ActivityIndicator color={Colors.brand} size="small" />
              <Text style={s.noDriverText}>Waiting for driver assignment…</Text>
            </View>
          )}

          {/* Addresses */}
          <View style={s.infoCard}>
            <View style={s.addrRow}>
              <View style={[s.addrDot, { backgroundColor: Colors.success }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.addrLabel}>Pickup</Text>
                <Text style={s.addrText}>{booking?.pickupAddress}</Text>
              </View>
            </View>
            <View style={[s.addrLine, { marginLeft: Spacing.sm + 4 }]} />
            <View style={s.addrRow}>
              <View style={[s.addrDot, { backgroundColor: Colors.danger }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.addrLabel}>Dropoff</Text>
                <Text style={s.addrText}>{booking?.dropoffAddress}</Text>
              </View>
            </View>
          </View>

          {/* Fare */}
          {booking?.estimatedFare && (
            <View
              style={[
                s.infoCard,
                { flexDirection: "row", justifyContent: "space-between" },
              ]}
            >
              <Text style={s.fareLabel}>Estimated fare</Text>
              <Text style={[s.fareValue, { color: Colors.brand }]}>
                £{booking.estimatedFare.toFixed(2)}
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
    waitingOverlay: {
      position: "absolute",
      top: "38%",
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
    waitingText: { fontSize: FontSize.sm, color: C.text },
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
      paddingBottom: Spacing.xs,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
      alignSelf: "center",
      marginBottom: Spacing.sm,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    statusIcon: { fontSize: 18 },
    statusLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: "700" },
    swipeHint: { fontSize: FontSize.xs, color: C.muted },
    refRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
      gap: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    refLabel: { fontSize: FontSize.xs, color: C.muted },
    refValue: {
      flex: 1,
      fontSize: FontSize.xs,
      color: C.brand,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    cancelBtn: {
      backgroundColor: C.danger + "15",
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: C.danger + "40",
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
    },
    cancelText: { color: C.danger, fontSize: FontSize.xs, fontWeight: "700" },
    expandedContent: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
    },
    noDriverCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      backgroundColor: C.bg,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    noDriverText: { fontSize: FontSize.sm, color: C.muted },
    infoCard: {
      backgroundColor: C.bg,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    addrRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: Spacing.sm,
      paddingVertical: 4,
    },
    addrDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    addrLine: {
      width: 2,
      height: 16,
      backgroundColor: C.border,
      marginVertical: 2,
    },
    addrLabel: { fontSize: FontSize.xs, color: C.muted },
    addrText: { fontSize: FontSize.sm, color: C.white, lineHeight: 20 },
    fareLabel: { fontSize: FontSize.sm, color: C.muted },
    fareValue: { fontSize: FontSize.md, fontWeight: "700" },
  });
