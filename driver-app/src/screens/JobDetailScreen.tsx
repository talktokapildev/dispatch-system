// driver-app/src/screens/JobDetailScreen.tsx
//
// Generic job detail view — map + route + address cards + reference/fare.
// Used today for claimed scheduled jobs (Start Trip / Release actions).
// Built status-agnostic so it can later be reused for Job History entries
// too: action buttons only render when job.status === "DRIVER_ASSIGNED",
// and fare falls back to actualFare for completed jobs. Nothing here
// assumes the job came from the claimed-jobs list specifically.
//
// Phase 2b: opens with { job } (from the job board) or just { bookingId }
// (tapping a flight push). Either way it re-fetches the job + flight from
// GET /drivers/jobs/:id/detail and keeps it fresh (socket, foreground, 2 min).
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { decodePolyline } from "../lib/mapUtils";
import TripMap from "../components/TripMap";
import AddressCard from "../components/AddressCard";
import FlightPanel from "../components/FlightPanel";
import { useJobDetail, hm } from "../lib/flight";
import { claimJob, legText } from "../lib/jobs";

export default function JobDetailScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const initialJob = route.params?.job ?? null;
  const bookingId: string | undefined =
    route.params?.bookingId ?? initialJob?.id;
  const detail = useJobDetail(bookingId);
  const job = detail.job ?? initialJob;
  const flight = detail.flight ?? initialJob?.flight ?? null;
  const distance = detail.distance ?? initialJob?.distance ?? null;
  const [confirming, setConfirming] = useState(false);

  const [routeCoords, setRouteCoords] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [busy, setBusy] = useState(false);

  const canManage = job?.status === "DRIVER_ASSIGNED";
  // Job still on the open job board: look before claiming.
  const isOpen = job?.status === "SCHEDULED_OPEN";

  // Job released / reassigned / deleted while open.
  useEffect(() => {
    if (!detail.notFound) return;
    Alert.alert(
      "Job no longer available",
      isOpen
        ? "Another driver has just claimed this job."
        : "This job isn't assigned to you any more.",
      [
      { text: "OK", onPress: () => navigation.goBack() },
    ]);
  }, [detail.notFound]);

  useEffect(() => {
    if (!job) return;
    const fetchRoute = async () => {
      try {
        const { data } = await api.get("/maps/directions", {
          params: {
            originLat: job.pickupLatitude,
            originLng: job.pickupLongitude,
            destLat: job.dropoffLatitude,
            destLng: job.dropoffLongitude,
          },
        });
        const polyline = data?.data?.polyline;
        if (polyline) setRouteCoords(decodePolyline(polyline));
      } catch {}
    };
    fetchRoute();
  }, [job?.id]);

  const handleConfirmEarlier = async (earliestAt: string) => {
    setConfirming(true);
    try {
      const { data } = await api.post(
        `/drivers/jobs/${job.id}/confirm-earlier`,
        { earliestAt }
      );
      Alert.alert(
        "Pickup moved",
        `New pickup ${hm(data.data.pickupAt)}.${
          data.data.smsSent
            ? " We've texted the passenger."
            : " We couldn't text the passenger - please call them."
        }`
      );
    } catch (err: any) {
      Alert.alert(
        "Couldn't confirm",
        err.response?.data?.error ?? "Please try again."
      );
    } finally {
      setConfirming(false);
      detail.refresh();
    }
  };

  const handleStart = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  const handleClaim = async () => {
    setBusy(true);
    const result = await claimJob(job.id);
    if (result === "claimed") {
      await detail.refresh(); // now mine → claimed mode (Release / Start)
      Alert.alert("Job claimed", 'It\'s now under "My Claimed" on the job board.');
    } else if (result === "gone") {
      navigation.goBack();
      return;
    }
    setBusy(false);
  };

  const handleRelease = () => {
    Alert.alert(
      "Release this job?",
      "It will go back to the open job board for another driver to claim.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Release",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api.post(`/bookings/${job.id}/release`);
              navigation.goBack();
            } catch (err: any) {
              Alert.alert(
                "Couldn't release job",
                err.response?.data?.error ?? "Please try again."
              );
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const s = styles(Colors);
  if (!job) {
    return (
      <View style={[s.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={Colors.brand} size="large" />
      </View>
    );
  }
  const fare = job.actualFare ?? job.estimatedFare ?? 0;

  return (
    <View style={s.container}>
      <View style={StyleSheet.absoluteFill}>
        <TripMap
          pickup={{
            latitude: job.pickupLatitude,
            longitude: job.pickupLongitude,
          }}
          dropoff={{
            latitude: job.dropoffLatitude,
            longitude: job.dropoffLongitude,
          }}
          routeCoords={routeCoords.length > 1 ? routeCoords : undefined}
          stage="offer"
          bottomPadding={420}
        />
      </View>

      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>

        <View style={s.sheet}>
          <ScrollView
            contentContainerStyle={s.sheetContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.headerRow}>
              <View style={s.typeBadge}>
                <Text style={s.typeText}>{job.type?.replace(/_/g, " ")}</Text>
              </View>
              <Text style={s.fare}>£{fare.toFixed(2)}</Text>
            </View>

            {job.scheduledAt ? (
              <Text style={s.scheduledTime}>
                📅 {format(new Date(job.scheduledAt), "EEEE dd MMM · HH:mm")}
              </Text>
            ) : job.createdAt ? (
              <Text style={s.scheduledTime}>
                {format(new Date(job.createdAt), "EEEE dd MMM · HH:mm")}
              </Text>
            ) : null}

            <AddressCard
              pickupAddress={job.pickupAddress}
              dropoffAddress={job.dropoffAddress}
              pickupMeta={legText(distance?.toPickup)}
              dropoffMeta={legText(distance?.trip)}
            />

            {flight ? (
              <FlightPanel
                flight={flight}
                canConfirm={canManage}
                confirming={confirming}
                onConfirmEarlier={handleConfirmEarlier}
                terminal={job.terminal}
              />
            ) : job.flightNumber && (
              <View style={s.infoCard}>
                <Text style={s.infoText}>
                  ✈️ Flight {job.flightNumber}
                  {job.terminal ? ` · Terminal ${job.terminal}` : ""}
                </Text>
              </View>
            )}

            {job.notes && (
              <View style={s.infoCard}>
                <Text style={s.infoLabel}>Notes</Text>
                <Text style={s.infoValue}>{job.notes}</Text>
              </View>
            )}

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
                {job.reference}
              </Text>
            </View>

            {isOpen && (
              <View style={s.actionsRow}>
                <TouchableOpacity
                  style={[s.startBtn, busy && s.btnDisabled]}
                  onPress={handleClaim}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={s.startBtnText}>Claim Job</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {canManage && (
              <View style={s.actionsRow}>
                {job.canStart && (
                  <TouchableOpacity
                    style={[s.startBtn, busy && s.btnDisabled]}
                    onPress={handleStart}
                    disabled={busy}
                  >
                    {busy ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Text style={s.startBtnText}>▶ Start Trip</Text>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[s.releaseBtn, busy && s.btnDisabled]}
                  onPress={handleRelease}
                  disabled={busy}
                >
                  <Text style={s.releaseBtnText}>Release Job</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    overlay: { flex: 1 },
    backBtn: {
      marginLeft: Spacing.lg,
      marginTop: Spacing.sm,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 6,
    },
    backIcon: { color: C.text, fontSize: FontSize.lg },
    sheet: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: "60%",
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      borderTopWidth: 1,
      borderColor: C.border,
    },
    sheetContent: { padding: Spacing.lg },
    headerRow: {
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
    fare: { fontSize: FontSize.xl, fontWeight: "800", color: C.brand },
    scheduledTime: {
      fontSize: FontSize.md,
      fontWeight: "700",
      color: C.text,
      marginBottom: Spacing.md,
    },
    infoCard: {
      backgroundColor: C.bg,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    infoLabel: { fontSize: FontSize.xs, color: C.muted },
    infoValue: { fontSize: FontSize.sm, color: C.white, marginTop: 2 },
    infoText: { fontSize: FontSize.sm, color: C.text },
    actionsRow: {
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
  });
