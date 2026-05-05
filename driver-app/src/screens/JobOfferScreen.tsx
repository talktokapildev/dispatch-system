import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { decodePolyline, toMiles } from "../lib/mapUtils";
import TripMap from "../components/TripMap";
import AddressCard from "../components/AddressCard";
import { getSocket } from "../lib/socket";
import { StatusBar } from "expo-status-bar";

const TIMEOUT_SECONDS = 60;

export default function JobOfferScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { offer } = route.params;

  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SECONDS);
  const [loading, setLoading] = useState<"accept" | "reject" | null>(null);
  const [driverLocation, setDriverLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [routeCoords, setRouteCoords] = useState<
    { latitude: number; longitude: number }[]
  >(offer.routePolyline ? decodePolyline(offer.routePolyline) : []);

  // Preloaded data for instant transition on accept
  const [preloadedBooking, setPreloadedBooking] = useState<any>(null);
  const [preloadedRoute, setPreloadedRoute] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [preloadedLocation, setPreloadedLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    startPulse();
    startTimer();
    initPreload();
    return () => {
      //clearInterval(timerRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      Vibration.cancel();
    };
  }, []);

  useEffect(() => {
    // Socket might not be ready immediately — retry once
    const attach = () => {
      const s = getSocket();
      if (!s) return;

      const handleCancelled = (data: any) => {
        if (data.bookingId === offer.bookingId) {
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
    };

    // Try immediately, then retry after 1s if socket not ready
    const cleanup = attach();
    if (cleanup) return cleanup;

    const timer = setTimeout(() => attach(), 1000);
    return () => clearTimeout(timer);
  }, [offer.bookingId]);

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setTimeout(() => navigation.goBack(), 0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const initPreload = async () => {
    // 1. Get GPS
    let coords: { latitude: number; longitude: number } | null = null;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setDriverLocation(coords);
      setPreloadedLocation(coords);
    } catch {}

    // 2. Fetch booking + driver→pickup route simultaneously
    const tasks: Promise<any>[] = [api.get(`/bookings/${offer.bookingId}`)];
    if (coords) {
      tasks.push(
        api.get("/maps/directions", {
          params: {
            originLat: coords.latitude,
            originLng: coords.longitude,
            destLat: offer.pickupLatitude,
            destLng: offer.pickupLongitude,
          },
        })
      );
    }

    const results = await Promise.allSettled(tasks);

    if (results[0].status === "fulfilled") {
      setPreloadedBooking(results[0].value.data.data);
    }
    if (results[1]?.status === "fulfilled") {
      const polyline = (results[1] as any).value?.data?.data?.polyline;
      if (polyline) setPreloadedRoute(decodePolyline(polyline));
    }
  };

  const accept = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setLoading("accept");
    try {
      await api.post(`/drivers/jobs/${offer.bookingId}/accept`);
      navigation.reset({
        index: 0,
        routes: [
          {
            name: "ActiveJob",
            params: {
              bookingId: offer.bookingId,
              preloadedBooking,
              preloadedRouteCoords: preloadedRoute,
              preloadedLocation,
            },
          },
        ],
      });
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Job no longer available"
      );
      navigation.goBack();
    } finally {
      setLoading(null);
    }
  };

  const reject = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setLoading("reject");
    try {
      await api.post(`/drivers/jobs/${offer.bookingId}/reject`);
    } catch {}
    navigation.goBack();
  };

  const urgentColor = secondsLeft <= 15 ? Colors.danger : Colors.brand;
  const s = styles(Colors);

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      {/* Full screen map */}
      <View style={StyleSheet.absoluteFill}>
        <TripMap
          key={offer.bookingId}
          driverLocation={driverLocation ?? undefined}
          pickup={{
            latitude: offer.pickupLatitude,
            longitude: offer.pickupLongitude,
          }}
          dropoff={
            offer.dropoffLatitude
              ? {
                  latitude: offer.dropoffLatitude,
                  longitude: offer.dropoffLongitude,
                }
              : undefined
          }
          routeCoords={routeCoords.length > 1 ? routeCoords : undefined}
          stage="offer"
          bottomPadding={420}
        />
      </View>

      {/* Bottom sheet overlay */}
      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        <View style={s.sheet}>
          {/* Header: timer + type + fare */}
          <View style={s.header}>
            <View style={s.timerRow}>
              <Animated.View
                style={[
                  s.timerRing,
                  {
                    borderColor: urgentColor,
                    transform: [{ scale: pulseAnim }],
                  },
                ]}
              >
                <Text style={[s.timerNumber, { color: urgentColor }]}>
                  {secondsLeft}
                </Text>
              </Animated.View>
              <View style={s.typeBadge}>
                <Text style={s.typeBadgeText}>
                  {offer.type?.replace(/_/g, " ")}
                </Text>
              </View>
            </View>
            <Text style={s.fare}>£{offer.estimatedFare?.toFixed(2)}</Text>
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            <StatCard
              icon="📍"
              value={`${
                offer.distanceToPickup ? toMiles(offer.distanceToPickup) : "—"
              } mi`}
              label={
                offer.timeToPickupMins
                  ? `~${offer.timeToPickupMins} min`
                  : "to pickup"
              }
            />
            <View style={s.statDivider} />
            <StatCard
              icon="🗺️"
              value={`${
                offer.tripDistanceKm ? toMiles(offer.tripDistanceKm) : "—"
              } mi`}
              label={
                offer.tripDurationMins
                  ? `~${offer.tripDurationMins} min trip`
                  : "trip distance"
              }
            />
            <View style={s.statDivider} />
            <StatCard
              icon="👥"
              value={String(offer.passengerCount)}
              label={`passenger${offer.passengerCount !== 1 ? "s" : ""}`}
            />
          </View>

          {/* Addresses */}
          <View style={s.addressWrapper}>
            <AddressCard
              pickupAddress={offer.pickupAddress}
              dropoffAddress={offer.dropoffAddress}
            />
          </View>

          {offer.notes && (
            <View style={s.notesBox}>
              <Text style={s.notesText}>📝 {offer.notes}</Text>
            </View>
          )}

          {/* Actions */}
          <View style={s.actions}>
            <TouchableOpacity
              style={[s.rejectBtn, loading === "reject" && s.btnDisabled]}
              onPress={reject}
              disabled={!!loading}
            >
              <Text style={s.rejectText}>✕ Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.acceptBtn, loading === "accept" && s.btnDisabled]}
              onPress={accept}
              disabled={!!loading}
            >
              {loading === "accept" ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={s.acceptText}>✓ Accept</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string;
  label: string;
}) {
  const { Colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text
        style={{
          fontSize: FontSize.md,
          fontWeight: "700",
          color: Colors.white,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontSize: FontSize.xs,
          color: Colors.muted,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    overlay: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      borderTopWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
      paddingBottom: Spacing.xl,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.md,
    },
    timerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
    timerRing: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 3,
      alignItems: "center",
      justifyContent: "center",
    },
    timerNumber: { fontSize: FontSize.lg, fontWeight: "800" },
    typeBadge: {
      backgroundColor: C.brand + "20",
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: C.brand + "40",
    },
    typeBadgeText: { color: C.brand, fontSize: FontSize.xs, fontWeight: "700" },
    fare: { fontSize: FontSize.xxl, fontWeight: "800", color: C.brand },
    statsRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: C.bg,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    statDivider: { width: 1, height: 40, backgroundColor: C.border },
    addressWrapper: { marginBottom: Spacing.xs },
    notesBox: {
      backgroundColor: C.bg,
      borderRadius: Radius.sm,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    notesText: { fontSize: FontSize.xs, color: C.muted },
    actions: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.sm },
    rejectBtn: {
      flex: 1,
      backgroundColor: C.danger + "15",
      borderWidth: 1,
      borderColor: C.danger + "40",
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
    },
    rejectText: { color: C.danger, fontWeight: "700", fontSize: FontSize.md },
    acceptBtn: {
      flex: 2,
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
    },
    acceptText: { color: "#000", fontWeight: "800", fontSize: FontSize.lg },
    btnDisabled: { opacity: 0.5 },
  });
