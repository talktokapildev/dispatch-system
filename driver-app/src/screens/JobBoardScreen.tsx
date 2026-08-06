// driver-app/src/screens/JobBoardScreen.tsx
//
// Lists SCHEDULED_OPEN bookings (the "job board") and lets a driver claim
// or release one. Claiming requires current GPS (used server-side for the
// ETA feasibility check). Follows JobHistoryScreen's list/header pattern.
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { format } from "date-fns";
import { toMiles } from "../lib/mapUtils";

interface ScheduledJob {
  id: string;
  reference: string;
  type: string;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffAddress: string;
  estimatedFare: number;
  scheduledAt: string;
  passengerCount: number;
  notes?: string;
  flightNumber?: string;
  terminal?: string;
}

export default function JobBoardScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const fetchJobs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const { data } = await api.get("/bookings/scheduled/open");
      setJobs(data.data ?? []);
    } catch {
      // silent — list just stays as-is / empty, pull-to-refresh available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Refresh whenever the driver returns to this tab — job board changes fast
  useFocusEffect(
    useCallback(() => {
      fetchJobs();
    }, [fetchJobs])
  );

  const getCurrentLocation = async (): Promise<{
    latitude: number;
    longitude: number;
  } | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location needed",
          "Your location is used to check you can reach pickup in time."
        );
        return null;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
    } catch {
      return null;
    }
  };

  const handleClaim = async (job: ScheduledJob) => {
    const coords = await getCurrentLocation();
    if (!coords) return;

    setClaimingId(job.id);
    try {
      await api.post(`/bookings/${job.id}/claim`, coords);
      setClaimedIds((prev) => new Set(prev).add(job.id));
    } catch (err: any) {
      const reason = err.response?.data?.error;
      const messages: Record<string, string> = {
        already_claimed: "Another driver just claimed this job.",
        eta_infeasible:
          "You wouldn't be able to reach pickup in time from your current location.",
        lock_contended: "This job is being claimed right now — try again.",
      };
      Alert.alert(
        "Couldn't claim job",
        messages[reason] ?? "Please try again."
      );
      if (reason === "already_claimed") {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
    } finally {
      setClaimingId(null);
    }
  };

  const handleRelease = async (job: ScheduledJob) => {
    setReleasingId(job.id);
    try {
      await api.post(`/bookings/${job.id}/release`);
      setClaimedIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    } catch (err: any) {
      Alert.alert(
        "Couldn't release job",
        err.response?.data?.error ?? "Please try again."
      );
    } finally {
      setReleasingId(null);
    }
  };

  const s = styles(Colors);

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={s.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={s.title}>Job Board</Text>
        </View>
        <ActivityIndicator
          color={Colors.brand}
          style={{ marginTop: Spacing.xxl }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Job Board</Text>
          <Text style={s.subtitle}>{jobs.length} scheduled jobs available</Text>
        </View>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchJobs(true)}
            tintColor={Colors.brand}
          />
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🗓️</Text>
            <Text style={s.emptyText}>No scheduled jobs open right now</Text>
            <Text style={s.emptySubtext}>
              Pull down to refresh — new jobs appear here as they're booked.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isClaimed = claimedIds.has(item.id);
          const isClaiming = claimingId === item.id;
          const isReleasing = releasingId === item.id;

          return (
            <View style={s.jobCard}>
              <View style={s.jobTop}>
                <View style={s.typeBadge}>
                  <Text style={s.typeText}>
                    {item.type?.replace(/_/g, " ")}
                  </Text>
                </View>
                <Text style={s.jobFare}>£{item.estimatedFare?.toFixed(2)}</Text>
              </View>

              <Text style={s.scheduledTime}>
                📅 {format(new Date(item.scheduledAt), "EEE dd MMM · HH:mm")}
              </Text>

              <View style={s.jobRoute}>
                <View style={s.routeRow}>
                  <View style={[s.dot, { backgroundColor: Colors.success }]} />
                  <Text style={s.routeText} numberOfLines={1}>
                    {item.pickupAddress}
                  </Text>
                </View>
                <View style={s.routeLine} />
                <View style={s.routeRow}>
                  <View style={[s.dot, { backgroundColor: Colors.danger }]} />
                  <Text style={s.routeText} numberOfLines={1}>
                    {item.dropoffAddress}
                  </Text>
                </View>
              </View>

              {item.flightNumber && (
                <Text style={s.metaText}>✈️ {item.flightNumber}</Text>
              )}
              {item.notes && <Text style={s.metaText}>📝 {item.notes}</Text>}

              {isClaimed ? (
                <View style={s.claimedRow}>
                  <View style={s.claimedBadge}>
                    <Text style={s.claimedBadgeText}>✓ Claimed by you</Text>
                  </View>
                  <TouchableOpacity
                    style={s.releaseBtn}
                    onPress={() => handleRelease(item)}
                    disabled={isReleasing}
                  >
                    {isReleasing ? (
                      <ActivityIndicator size="small" color={Colors.danger} />
                    ) : (
                      <Text style={s.releaseBtnText}>Release</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.claimBtn, isClaiming && s.btnDisabled]}
                  onPress={() => handleClaim(item)}
                  disabled={isClaiming || !!claimingId}
                >
                  {isClaiming ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={s.claimBtnText}>Claim Job</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      padding: Spacing.lg,
      paddingBottom: Spacing.sm,
      gap: Spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
      justifyContent: "center",
    },
    backIcon: { color: C.text, fontSize: FontSize.lg },
    title: { fontSize: FontSize.xxl, fontWeight: "700", color: C.white },
    subtitle: { fontSize: FontSize.sm, color: C.muted, marginTop: 2 },
    list: { padding: Spacing.lg, gap: Spacing.sm },
    jobCard: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    jobTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    typeBadge: {
      backgroundColor: C.brand + "20",
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: C.brand + "40",
    },
    typeText: { color: C.brand, fontSize: FontSize.xs, fontWeight: "700" },
    jobFare: { fontSize: FontSize.lg, fontWeight: "800", color: C.brand },
    scheduledTime: {
      fontSize: FontSize.sm,
      color: C.text,
      fontWeight: "600",
      marginBottom: Spacing.sm,
    },
    jobRoute: { marginBottom: Spacing.sm },
    routeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    routeText: { fontSize: FontSize.sm, color: C.text, flex: 1 },
    routeLine: {
      width: 2,
      height: 12,
      backgroundColor: C.border,
      marginLeft: 3,
      marginVertical: 2,
    },
    metaText: { fontSize: FontSize.xs, color: C.muted, marginBottom: 4 },
    claimBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    claimBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    btnDisabled: { opacity: 0.5 },
    claimedRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: Spacing.sm,
    },
    claimedBadge: {
      backgroundColor: C.success + "20",
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: C.success + "40",
    },
    claimedBadgeText: {
      color: C.success,
      fontSize: FontSize.xs,
      fontWeight: "700",
    },
    releaseBtn: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.danger + "40",
      paddingHorizontal: Spacing.md,
      paddingVertical: 8,
    },
    releaseBtnText: {
      color: C.danger,
      fontSize: FontSize.xs,
      fontWeight: "700",
    },
    empty: { alignItems: "center", paddingTop: Spacing.xxl },
    emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
    emptyText: { fontSize: FontSize.md, color: C.muted, marginBottom: 4 },
    emptySubtext: {
      fontSize: FontSize.xs,
      color: C.muted,
      textAlign: "center",
      paddingHorizontal: Spacing.xl,
    },
  });
