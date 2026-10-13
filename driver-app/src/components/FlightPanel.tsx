// driver-app/src/components/FlightPanel.tsx
//
// Phase 2b — flight panel on the job detail screen:
//   status chip · origin · scheduled landing · take-off · gate (expected/actual)
//   pickup = gate + X min · moved from · checked X min ago · FlightAware
//   ⚠ airline schedule change (weeks ahead, before tracking starts)
//   "Flight is early" box with a one-tap "Yes, pick up at HH:MM" button
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { DriverFlight, flightToneColor, hm, minutesAgo } from "../lib/flight";

type Props = {
  flight: DriverFlight;
  /** Show the confirm button (driver's own, not-started job). */
  canConfirm: boolean;
  confirming: boolean;
  onConfirmEarlier: (earliestAt: string) => void;
  terminal?: string | null;
};

export function FlightChip({ flight }: { flight: DriverFlight }) {
  const { Colors } = useTheme();
  const color = flightToneColor(flight.tone, Colors);
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: color + "20",
        borderColor: color + "50",
        borderWidth: 1,
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color, fontSize: FontSize.xs, fontWeight: "700" }}>
        {flight.chip}
      </Text>
    </View>
  );
}

export default function FlightPanel({
  flight,
  canConfirm,
  confirming,
  onConfirmEarlier,
  terminal,
}: Props) {
  const { Colors } = useTheme();
  const s = styles(Colors);
  // Re-render every 30 s so "checked X min ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const moved =
    flight.pickupAt &&
    flight.bookedPickupAt &&
    flight.pickupAt !== flight.bookedPickupAt;
  const live = flight.state !== "SCHEDULED";

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Text style={s.title}>
          ✈️ {flight.flightNumber}
          {flight.airline ? ` · ${flight.airline}` : ""}
        </Text>
        <FlightChip flight={flight} />
      </View>
      {(flight.origin || terminal) && (
        <Text style={s.sub}>
          {[
            flight.origin && `From ${flight.origin}`,
            terminal && `${terminal[0]}${terminal.slice(1).toLowerCase()} Terminal`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      )}

      {flight.scheduleNotice && (
        <View style={[s.notice, { borderColor: Colors.warning + "60" }]}>
          <Text style={[s.noticeTitle, { color: Colors.warning }]}>
            ⚠ {flight.scheduleNotice.text}
          </Text>
          <Text style={s.noticeBody}>
            Your pickup is still {hm(flight.pickupAt)}. If the new timing no
            longer suits you, release the job so another driver can take it.
          </Text>
        </View>
      )}

      <Row label="Scheduled landing" value={hm(flight.scheduledLandingAt)} />
      {flight.takeOffAt && <Row label="Took off" value={hm(flight.takeOffAt)} />}
      {live && flight.gateAt && (
        <Row
          label={flight.gateIsActual ? "At gate" : "Expected at gate"}
          value={`${flight.gateIsActual ? "" : "~"}${hm(flight.gateAt)}`}
        />
      )}
      <Row
        label="Pickup"
        value={`${hm(flight.pickupAt)}${
          flight.offsetMinutes != null
            ? `  (gate + ${flight.offsetMinutes} min)`
            : ""
        }`}
        strong
      />
      {moved && <Row label="Moved from" value={hm(flight.bookedPickupAt)} />}
      {live && (
        <Row label="Last checked" value={minutesAgo(flight.lastCheckedAt)} />
      )}

      {flight.earlierPickup && canConfirm && (
        <View style={[s.notice, { borderColor: Colors.success + "60" }]}>
          <Text style={[s.noticeTitle, { color: Colors.success }]}>
            Flight is early
          </Text>
          <Text style={s.noticeBody}>
            The passenger can be ready from{" "}
            {hm(flight.earlierPickup.earliestAt)}. Can you make it? We'll text
            the passenger the new time.
          </Text>
          <TouchableOpacity
            style={[s.confirmBtn, { backgroundColor: Colors.success }, confirming && { opacity: 0.5 }]}
            disabled={confirming}
            onPress={() => onConfirmEarlier(flight.earlierPickup!.earliestAt)}
          >
            {confirming ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.confirmText}>
                Yes, pick up at {hm(flight.earlierPickup.earliestAt)}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity onPress={() => Linking.openURL(flight.flightAwareUrl)}>
        <Text style={[s.link, { color: Colors.info }]}>Open in FlightAware ↗</Text>
      </TouchableOpacity>
    </View>
  );

  function Row({
    label,
    value,
    strong,
  }: {
    label: string;
    value: string;
    strong?: boolean;
  }) {
    return (
      <View style={s.row}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={[s.rowValue, strong && { fontWeight: "800" }]}>{value}</Text>
      </View>
    );
  }
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    card: {
      backgroundColor: C.info + "10",
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.info + "30",
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: Spacing.sm,
    },
    title: { color: C.text, fontSize: FontSize.md, fontWeight: "700", flexShrink: 1 },
    sub: { color: C.muted, fontSize: FontSize.sm, marginTop: 2, marginBottom: Spacing.xs },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 3,
    },
    rowLabel: { color: C.muted, fontSize: FontSize.sm },
    rowValue: { color: C.text, fontSize: FontSize.sm },
    notice: {
      borderWidth: 1,
      borderRadius: Radius.md,
      padding: Spacing.sm,
      marginVertical: Spacing.sm,
      backgroundColor: C.card,
    },
    noticeTitle: { fontSize: FontSize.sm, fontWeight: "700" },
    noticeBody: { color: C.text, fontSize: FontSize.sm, marginTop: 4 },
    confirmBtn: {
      marginTop: Spacing.sm,
      borderRadius: Radius.md,
      padding: Spacing.sm + 2,
      alignItems: "center",
    },
    confirmText: { color: "#fff", fontWeight: "800", fontSize: FontSize.md },
    link: { fontSize: FontSize.sm, marginTop: Spacing.sm },
  });
