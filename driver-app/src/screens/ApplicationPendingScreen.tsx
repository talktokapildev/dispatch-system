// driver-app/src/screens/ApplicationPendingScreen.tsx
// Step 3 of the self-onboarding flow.
// Polls GET /driver-applications/:id every 30s.
// PENDING  → "Under review" message
// APPROVED → congrats + login prompt
// REJECTED → rejection reason + edit/resubmit option

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useNavigation,
  useRoute,
  RouteProp,
  useFocusEffect,
} from "@react-navigation/native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { APPLICATION_ID_KEY } from "./LoginScreen";

type RouteParams = { applicationId: string };
type AppStatus = "PENDING" | "APPROVED" | "REJECTED";

const POLL_INTERVAL_MS = 30_000;

export default function ApplicationPendingScreen() {
  const { Colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const { applicationId } = route.params;

  const [status, setStatus] = useState<AppStatus>("PENDING");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/driver-applications/${applicationId}`);
      setStatus(data.status);
      setRejectionReason(data.rejectionReason ?? null);
      setSubmittedAt(data.submittedAt ?? null);
      setLastChecked(new Date());
      setError(null);
    } catch (err: any) {
      setError("Could not check status. Will retry automatically.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Fetch on mount + poll every 30s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Refresh when screen comes back into focus (e.g. after editing)
  useFocusEffect(
    useCallback(() => {
      fetchStatus();
    }, [fetchStatus])
  );

  // Clear stored applicationId and go back to login for approved drivers
  const handleLoginNow = async () => {
    await AsyncStorage.removeItem(APPLICATION_ID_KEY);
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  // Go to DriverApplication to edit and resubmit
  const handleResubmit = () => {
    navigation.navigate("DriverApplication");
  };

  const s = styles(Colors);

  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
        <View style={s.center}>
          <ActivityIndicator color={Colors.brand} size="large" />
          <Text style={s.loadingText}>Checking your application…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PENDING ── */}
        {status === "PENDING" && (
          <>
            <View style={s.iconCircle}>
              <Text style={s.iconEmoji}>⏳</Text>
            </View>
            <Text style={s.title}>Application Under Review</Text>
            <Text style={s.subtitle}>
              Our team is reviewing your application and documents. This usually
              takes 1–3 business days.
            </Text>

            {submittedAt && (
              <View style={s.infoCard}>
                <Text style={s.infoLabel}>Submitted</Text>
                <Text style={s.infoValue}>
                  {new Date(submittedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
              </View>
            )}

            <View style={s.infoCard}>
              <Text style={s.infoLabel}>Application ID</Text>
              <Text style={[s.infoValue, s.mono]}>{applicationId}</Text>
            </View>

            <View style={s.pendingNote}>
              <Text style={s.pendingNoteText}>
                🔔 We'll update your status here automatically. You don't need
                to do anything — just check back here.
              </Text>
            </View>

            {error && <Text style={s.errorText}>{error}</Text>}

            <TouchableOpacity style={s.refreshBtn} onPress={fetchStatus}>
              <Text style={s.refreshBtnText}>Check Now</Text>
            </TouchableOpacity>

            <Text style={s.lastChecked}>
              Last checked:{" "}
              {lastChecked.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </>
        )}

        {/* ── APPROVED ── */}
        {status === "APPROVED" && (
          <>
            <View style={[s.iconCircle, s.iconCircleGreen]}>
              <Text style={s.iconEmoji}>🎉</Text>
            </View>
            <Text style={s.title}>You're Approved!</Text>
            <Text style={s.subtitle}>
              Your application has been approved. Your driver account is ready —
              log in with your mobile number to get started.
            </Text>

            <View style={[s.infoCard, s.infoCardGreen]}>
              <Text style={[s.infoLabel, { color: "#22c55e" }]}>Status</Text>
              <Text
                style={[s.infoValue, { color: "#22c55e", fontWeight: "700" }]}
              >
                ✓ Approved
              </Text>
            </View>

            <TouchableOpacity style={s.approvedBtn} onPress={handleLoginNow}>
              <Text style={s.approvedBtnText}>Log In Now →</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── REJECTED ── */}
        {status === "REJECTED" && (
          <>
            <View style={[s.iconCircle, s.iconCircleRed]}>
              <Text style={s.iconEmoji}>❌</Text>
            </View>
            <Text style={s.title}>Application Unsuccessful</Text>
            <Text style={s.subtitle}>
              Unfortunately your application was not approved. Please review the
              reason below and resubmit with the correct information.
            </Text>

            {rejectionReason && (
              <View style={[s.infoCard, s.infoCardRed]}>
                <Text style={[s.infoLabel, { color: "#f87171" }]}>Reason</Text>
                <Text style={[s.infoValue, { color: "#fca5a5" }]}>
                  {rejectionReason}
                </Text>
              </View>
            )}

            <TouchableOpacity style={s.resubmitBtn} onPress={handleResubmit}>
              <Text style={s.resubmitBtnText}>Edit & Resubmit →</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.contactBtn}>
              <Text style={s.contactBtnText}>Contact Us</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.md,
    },
    loadingText: {
      fontSize: FontSize.sm,
      color: C.muted,
      marginTop: Spacing.sm,
    },
    scroll: {
      flexGrow: 1,
      alignItems: "center",
      padding: Spacing.lg,
      paddingBottom: Spacing.xxl,
    },
    iconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: "rgba(255,140,26,0.15)",
      alignItems: "center",
      justifyContent: "center",
      marginTop: Spacing.xxl,
      marginBottom: Spacing.lg,
    },
    iconCircleGreen: { backgroundColor: "rgba(34,197,94,0.15)" },
    iconCircleRed: { backgroundColor: "rgba(239,68,68,0.15)" },
    iconEmoji: { fontSize: 40 },
    title: {
      fontSize: FontSize.xxl,
      fontWeight: "700",
      color: C.text,
      textAlign: "center",
      marginBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: C.muted,
      textAlign: "center",
      lineHeight: 22,
      marginBottom: Spacing.xl,
      paddingHorizontal: Spacing.sm,
    },
    infoCard: {
      width: "100%",
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    infoCardGreen: {
      borderColor: "rgba(34,197,94,0.3)",
      backgroundColor: "rgba(34,197,94,0.06)",
    },
    infoCardRed: {
      borderColor: "rgba(239,68,68,0.3)",
      backgroundColor: "rgba(239,68,68,0.06)",
    },
    infoLabel: { fontSize: FontSize.xs, color: C.muted, marginBottom: 4 },
    infoValue: { fontSize: FontSize.sm, color: C.text },
    mono: {
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      fontSize: FontSize.xs,
    },
    pendingNote: {
      width: "100%",
      backgroundColor: "rgba(255,140,26,0.08)",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: "rgba(255,140,26,0.2)",
      padding: Spacing.md,
      marginBottom: Spacing.lg,
    },
    pendingNoteText: { fontSize: FontSize.sm, color: C.muted, lineHeight: 20 },
    errorText: {
      fontSize: FontSize.xs,
      color: "#f87171",
      marginBottom: Spacing.sm,
      textAlign: "center",
    },
    refreshBtn: {
      width: "100%",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    refreshBtnText: {
      fontSize: FontSize.sm,
      color: C.muted,
      fontWeight: "600",
    },
    lastChecked: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: Spacing.xs,
    },
    approvedBtn: {
      width: "100%",
      backgroundColor: "#22c55e",
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    approvedBtnText: {
      color: "#000",
      fontWeight: "700",
      fontSize: FontSize.md,
    },
    resubmitBtn: {
      width: "100%",
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    resubmitBtnText: {
      color: "#000",
      fontWeight: "700",
      fontSize: FontSize.md,
    },
    contactBtn: {
      width: "100%",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    contactBtnText: {
      fontSize: FontSize.sm,
      color: C.muted,
      fontWeight: "600",
    },
  });

// Needed for mono style reference
import { Platform } from "react-native";
