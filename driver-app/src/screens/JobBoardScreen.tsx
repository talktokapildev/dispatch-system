// driver-app/src/screens/JobBoardScreen.tsx
//
// Two tabs: "Open" (SCHEDULED_OPEN pool, claimable) and "My Claimed"
// (jobs this driver has claimed but not yet started — needed because a
// claimed job disappears from the open pool immediately, so this is the
// only way back to it to release it later).
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
  canStart?: boolean;
}

type Tab = "open" | "claimed";

export default function JobBoardScreen({ navigation, route }: any) {
  const { Colors } = useTheme();
  const [tab, setTab] = useState<Tab>(
    route?.params?.initialTab === "claimed" ? "claimed" : "open"
  );
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchJobs = useCallback(async (activeTab: Tab, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const endpoint =
        activeTab === "open"
          ? "/bookings/scheduled/open"
          : "/bookings/scheduled/mine";
      const { data } = await api.get(endpoint);
      setJobs(data.data ?? []);
    } catch {
      // silent — pull-to-refresh available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs(tab);
  }, [tab, fetchJobs]);

  useFocusEffect(
    useCallback(() => {
      fetchJobs(tab);
    }, [tab, fetchJobs])
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

    setBusyId(job.id);
    try {
      await api.post(`/bookings/${job.id}/claim`, coords);
      // Job leaves the open pool — remove locally for instant feedback,
      // then let the "My Claimed" tab pick it up next time it's viewed.
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      Alert.alert(
        "Job claimed",
        'Find it any time under the "My Claimed" tab.'
      );
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
      setBusyId(null);
    }
  };

  const handleRelease = async (job: ScheduledJob) => {
    setBusyId(job.id);
    try {
      await api.post(`/bookings/${job.id}/release`);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (err: any) {
      Alert.alert(
        "Couldn't release job",
        err.response?.data?.error ?? "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleStart = async (job: ScheduledJob) => {
    setBusyId(job.id);
    try {
      const { data } = await api.post(`/bookings/${job.id}/start`);
      navigation.reset({
        index: 0,
        routes: [
          {
            name: "ActiveJob",
            params: { bookingId: job.id, preloadedBooking: data.data },
          },
        ],
      });
    } catch (err: any) {
      Alert.alert(
        "Couldn't start trip",
        err.response?.data?.error ?? "Please try again."
      );
    } finally {
      setBusyId(null);
    }
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Job Board</Text>
          <Text style={s.subtitle}>
            {tab === "open"
              ? `${jobs.length} scheduled jobs available`
              : `${jobs.length} jobs you've claimed`}
          </Text>
        </View>
      </View>

      <View style={s.tabRow}>
        <TouchableOpacity
          style={[s.tabBtn, tab === "open" && s.tabBtnActive]}
          onPress={() => setTab("open")}
        >
          <Text style={[s.tabBtnText, tab === "open" && s.tabBtnTextActive]}>
            Open
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === "claimed" && s.tabBtnActive]}
          onPress={() => setTab("claimed")}
        >
          <Text style={[s.tabBtnText, tab === "claimed" && s.tabBtnTextActive]}>
            My Claimed
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator
          color={Colors.brand}
          style={{ marginTop: Spacing.xxl }}
        />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchJobs(tab, true)}
              tintColor={Colors.brand}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>{tab === "open" ? "🗓️" : "📌"}</Text>
              <Text style={s.emptyText}>
                {tab === "open"
                  ? "No scheduled jobs open right now"
                  : "You haven't claimed any jobs yet"}
              </Text>
              <Text style={s.emptySubtext}>
                {tab === "open"
                  ? "Pull down to refresh — new jobs appear here as they're booked."
                  : "Claimed jobs from the Open tab will show up here."}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isBusy = busyId === item.id;
            return (
              <View style={s.jobCard}>
                <View style={s.jobTop}>
                  <View style={s.typeBadge}>
                    <Text style={s.typeText}>
                      {item.type?.replace(/_/g, " ")}
                    </Text>
                  </View>
                  <Text style={s.jobFare}>
                    £{item.estimatedFare?.toFixed(2)}
                  </Text>
                </View>

                <Text style={s.scheduledTime}>
                  📅 {format(new Date(item.scheduledAt), "EEE dd MMM · HH:mm")}
                </Text>

                <View style={s.jobRoute}>
                  <View style={s.routeRow}>
                    <View
                      style={[s.dot, { backgroundColor: Colors.success }]}
                    />
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

                {tab === "open" ? (
                  <TouchableOpacity
                    style={[s.claimBtn, isBusy && s.btnDisabled]}
                    onPress={() => handleClaim(item)}
                    disabled={isBusy || !!busyId}
                  >
                    {isBusy ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Text style={s.claimBtnText}>Claim Job</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={s.claimedActionsRow}>
                    {item.canStart && (
                      <TouchableOpacity
                        style={[s.startBtn, isBusy && s.btnDisabled]}
                        onPress={() => handleStart(item)}
                        disabled={isBusy || !!busyId}
                      >
                        {isBusy ? (
                          <ActivityIndicator color="#000" />
                        ) : (
                          <Text style={s.startBtnText}>▶ Start Trip</Text>
                        )}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[s.releaseBtn, isBusy && s.btnDisabled]}
                      onPress={() => handleRelease(item)}
                      disabled={isBusy || !!busyId}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color={Colors.danger} />
                      ) : (
                        <Text style={s.releaseBtnText}>Release Job</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
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
    tabRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    tabBtn: {
      flex: 1,
      alignItems: "center",
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.card,
    },
    tabBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
    tabBtnText: { fontSize: FontSize.sm, color: C.muted, fontWeight: "600" },
    tabBtnTextActive: { color: "#000" },
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
    claimedActionsRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    startBtn: {
      flex: 1,
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    startBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    releaseBtn: {
      flex: 1,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.danger + "40",
      padding: Spacing.md,
      alignItems: "center",
    },
    releaseBtnText: {
      color: C.danger,
      fontWeight: "700",
      fontSize: FontSize.md,
    },
    btnDisabled: { opacity: 0.5 },
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
