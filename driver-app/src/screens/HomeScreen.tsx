import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { api, useAuthStore } from "../lib/api";
import { useSocket } from "../lib/socket";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useLocationTracking } from "../hooks/useLocationTracking";
import { BackgroundLocationDisclosure } from "../components/BackgroundLocationDisclosure";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

const DISCLOSURE_ACCEPTED_KEY = "bg_location_disclosure_accepted";

export default function HomeScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const { user, driver, logout, token, setAuth, _hasHydrated } = useAuthStore();
  const [status, setStatus] = useState(driver?.status ?? "OFFLINE");
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todayJobs, setTodayJobs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const { getInitialLocation, locationRef } = useLocationTracking();

  const STATUS_COLORS: Record<string, string> = {
    OFFLINE: Colors.muted,
    AVAILABLE: Colors.success,
    ON_JOB: Colors.brand,
    BREAK: "#f97316",
  };

  useSocket({
    "driver:job_offer": (data) =>
      navigation.navigate("JobOffer", { offer: data }),
    "driver:job_assigned": (data) => {
      navigation.navigate("ActiveJob", { bookingId: data.bookingId });
    },
  });

  useEffect(() => {
    fetchEarnings();
    refreshDriverProfile();
    if (status === "AVAILABLE" || status === "ON_JOB") startLocationTracking();
  }, [status]);

  // Re-run fetch when store finishes hydrating from AsyncStorage
  useEffect(() => {
    if (_hasHydrated) {
      fetchEarnings();
      refreshDriverProfile();
    }
  }, [_hasHydrated]);

  const fetchEarnings = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .split("T")[0];
      const { data } = await api.get("/drivers/earnings", {
        params: { from: today, to: tomorrow },
      });
      setTodayEarnings(data.data.summary.totalNet);
      setTodayJobs(data.data.summary.jobCount);
    } catch {}
  };

  const refreshDriverProfile = async () => {
    try {
      const { data } = await api.get("/auth/me");
      const freshDriver = data.data.driver;
      // Read current store state directly — avoids stale closure values
      const { token: currentToken, user: currentUser } =
        useAuthStore.getState();
      if (freshDriver && currentToken && currentUser) {
        setAuth(currentToken, currentUser, freshDriver);
      }
    } catch {}
  };

  const startLocationTracking = async () => {
    const coords = await getInitialLocation();
    if (!coords) {
      Alert.alert(
        "Permission needed",
        "Location permission is required to go online"
      );
    }
  };

  // Check if driver has already accepted the disclosure
  const hasAcceptedDisclosure = async (): Promise<boolean> => {
    try {
      const val = await AsyncStorage.getItem(DISCLOSURE_ACCEPTED_KEY);
      return val === "true";
    } catch {
      return false;
    }
  };

  const acceptDisclosure = async () => {
    try {
      await AsyncStorage.setItem(DISCLOSURE_ACCEPTED_KEY, "true");
    } catch {}
    setShowDisclosure(false);
    await proceedGoOnline();
  };

  const declineDisclosure = () => {
    setShowDisclosure(false);
  };

  const toggleOnline = async () => {
    const newStatus = status === "OFFLINE" ? "AVAILABLE" : "OFFLINE";

    if (newStatus === "OFFLINE") {
      // Going offline — no disclosure needed, just proceed
      setLoading(true);
      try {
        await api.patch("/drivers/status", { status: newStatus });
        setStatus(newStatus);
        const isRegistered = await TaskManager.isTaskRegisteredAsync(
          "background-location-task"
        );
        if (isRegistered) {
          await Location.stopLocationUpdatesAsync("background-location-task");
        }
      } catch (err: any) {
        Alert.alert(
          "Error",
          err.response?.data?.error ?? "Failed to update status"
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    // Going online — check if disclosure already accepted
    const alreadyAccepted = await hasAcceptedDisclosure();
    if (alreadyAccepted) {
      await proceedGoOnline();
    } else {
      // Show prominent disclosure before requesting background location
      setShowDisclosure(true);
    }
  };

  const proceedGoOnline = async () => {
    setLoading(true);
    try {
      await api.patch("/drivers/status", { status: "AVAILABLE" });
      setStatus("AVAILABLE");
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Failed to update status"
      );
    } finally {
      setLoading(false);
    }
  };

  const setBreak = async () => {
    const newStatus = status === "BREAK" ? "AVAILABLE" : "BREAK";
    try {
      await api.patch("/drivers/status", { status: newStatus });
      setStatus(newStatus);
    } catch {}
  };

  const isOnline = status !== "OFFLINE";
  const s = styles(Colors);

  // ─── Heartbeat — keep driver in Redis while online ───────────────────────
  useEffect(() => {
    if (!isOnline) return;

    const sendHeartbeat = async () => {
      try {
        const loc = locationRef.current;
        await api.patch(
          "/drivers/heartbeat",
          loc
            ? {
                latitude: loc.latitude,
                longitude: loc.longitude,
                bearing: 0,
              }
            : {}
        );
      } catch {}
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isOnline]);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Good {getTimeOfDay()},</Text>
            <Text style={s.name}>
              {`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()}
            </Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate("Profile")}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>
                {`${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Status card */}
        <View
          style={[s.statusCard, { borderColor: STATUS_COLORS[status] + "40" }]}
        >
          <View style={s.statusRow}>
            <View>
              <Text style={s.statusLabel}>Status</Text>
              <View style={s.statusBadge}>
                <View
                  style={[
                    s.statusDot,
                    { backgroundColor: STATUS_COLORS[status] },
                  ]}
                />
                <Text style={[s.statusText, { color: STATUS_COLORS[status] }]}>
                  {status.replace("_", " ")}
                </Text>
              </View>
            </View>
            <Switch
              value={isOnline}
              onValueChange={toggleOnline}
              disabled={loading || status === "ON_JOB"}
              trackColor={{ false: Colors.border, true: Colors.brand + "60" }}
              thumbColor={isOnline ? Colors.brand : Colors.muted}
            />
          </View>
          {isOnline && status !== "ON_JOB" && (
            <TouchableOpacity
              style={[s.breakBtn, status === "BREAK" && s.breakBtnActive]}
              onPress={setBreak}
            >
              <Text
                style={[
                  s.breakBtnText,
                  status === "BREAK" && { color: "#f97316" },
                ]}
              >
                {status === "BREAK" ? "▶ Resume" : "⏸ Take a Break"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>£{todayEarnings.toFixed(2)}</Text>
            <Text style={s.statLabel}>Today's Earnings</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{todayJobs}</Text>
            <Text style={s.statLabel}>Jobs Today</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>
              ★ {driver?.rating?.toFixed(1) ?? "5.0"}
            </Text>
            <Text style={s.statLabel}>Rating</Text>
          </View>
        </View>

        {/* Vehicle */}
        {driver?.vehicle && (
          <View style={s.vehicleCard}>
            <Text style={s.vehicleTitle}>🚗 Your Vehicle</Text>
            <Text style={s.vehicleText}>
              {driver.vehicle.make} {driver.vehicle.model}
            </Text>
            <Text style={s.vehiclePlate}>{driver.vehicle.licensePlate}</Text>
          </View>
        )}

        {/* Quick actions */}
        <View style={s.actionsGrid}>
          {[
            { label: "Job History", icon: "📋", screen: "JobHistory" },
            { label: "Earnings", icon: "💷", screen: "Earnings" },
            { label: "Documents", icon: "📄", screen: "Documents" },
            { label: "Profile", icon: "👤", screen: "Profile" },
          ].map((action) => (
            <TouchableOpacity
              key={action.screen}
              style={s.actionBtn}
              onPress={() => navigation.navigate(action.screen)}
            >
              <Text style={s.actionIcon}>{action.icon}</Text>
              <Text style={s.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* PCO badge */}
        {driver?.pcoBadgeNumber && (
          <View style={s.pcoCard}>
            <Text style={s.pcoLabel}>PCO Badge</Text>
            <Text style={s.pcoNumber}>{driver.pcoBadgeNumber}</Text>
          </View>
        )}
      </ScrollView>

      {/* Background location disclosure modal */}
      <BackgroundLocationDisclosure
        visible={showDisclosure}
        onAccept={acceptDisclosure}
        onDecline={declineDisclosure}
      />
    </SafeAreaView>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    greeting: { fontSize: FontSize.sm, color: C.muted },
    name: { fontSize: FontSize.xl, fontWeight: "700", color: C.white },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: C.brand + "30",
      borderWidth: 2,
      borderColor: C.brand + "60",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: C.brand, fontWeight: "700", fontSize: FontSize.md },
    statusCard: {
      margin: Spacing.lg,
      marginTop: Spacing.sm,
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      padding: Spacing.lg,
    },
    statusRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    statusLabel: { fontSize: FontSize.xs, color: C.muted, marginBottom: 4 },
    statusBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: FontSize.lg, fontWeight: "700" },
    breakBtn: {
      marginTop: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
    },
    breakBtnActive: {
      borderColor: "#f97316" + "60",
      backgroundColor: "#f97316" + "10",
    },
    breakBtnText: { fontSize: FontSize.sm, color: C.muted, fontWeight: "600" },
    statsRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
    },
    statCard: {
      flex: 1,
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      alignItems: "center",
    },
    statValue: { fontSize: FontSize.lg, fontWeight: "700", color: C.brand },
    statLabel: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 2,
      textAlign: "center",
    },
    vehicleCard: {
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
    },
    vehicleTitle: { fontSize: FontSize.sm, color: C.muted, marginBottom: 4 },
    vehicleText: { fontSize: FontSize.md, color: C.white, fontWeight: "600" },
    vehiclePlate: {
      fontSize: FontSize.sm,
      color: C.brand,
      marginTop: 2,
      fontWeight: "700",
    },
    actionsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
    },
    actionBtn: {
      width: "47%",
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      alignItems: "center",
    },
    actionIcon: { fontSize: 24, marginBottom: 6 },
    actionLabel: { fontSize: FontSize.sm, color: C.text, fontWeight: "500" },
    pcoCard: {
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.lg,
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: C.brand + "10",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "30",
      padding: Spacing.md,
    },
    pcoLabel: { fontSize: FontSize.sm, color: C.muted },
    pcoNumber: { fontSize: FontSize.sm, color: C.brand, fontWeight: "700" },
  });
