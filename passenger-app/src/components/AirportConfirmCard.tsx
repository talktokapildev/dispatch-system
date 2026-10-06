// passenger-app/src/components/AirportConfirmCard.tsx
//
// "Your flight" + meeting point card on the Confirm Ride screen.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { AirportBookingState, TERMINAL_LABEL, ukTime } from "../lib/airport";

export default function AirportConfirmCard({
  airport,
}: {
  airport: AirportBookingState | null | undefined;
}) {
  const { Colors } = useTheme();
  const s = styles(Colors);
  if (!airport?.meetingPoint) return null;
  const mp = airport.meetingPoint;
  const f = airport.flight;

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{f ? "Your Flight" : "Airport Pickup"}</Text>
      {f && (
        <>
          <Row label="Flight" value={f.display} s={s} />
          {f.originName && <Row label="From" value={f.originName} s={s} />}
          <Row
            label="Lands"
            value={
              Math.abs(
                new Date(f.expectedArrivalUtc).getTime() -
                  new Date(f.scheduledArrivalUtc).getTime()
              ) >=
              5 * 60_000
                ? `Expected ${ukTime(f.expectedArrivalUtc)} (scheduled ${ukTime(
                    f.scheduledArrivalUtc
                  )})`
                : `${ukTime(f.scheduledArrivalUtc)} (UK time)`
            }
            s={s}
          />
          <Row
            label="Luggage"
            value={
              f.luggageType === "HAND" ? "Hand luggage only" : "Checked bags"
            }
            s={s}
          />
        </>
      )}
      <Row
        label="Terminal"
        value={TERMINAL_LABEL[mp.terminal] ?? mp.terminal}
        s={s}
        last
      />

      <View style={s.meetBox}>
        <Text style={s.meetLabel}>Meet your driver</Text>
        <Text style={s.meetName}>{mp.name}</Text>
        <Text style={s.meetText}>{mp.instructions}</Text>
      </View>

      {f && (
        <Text style={s.note}>
          ✈ Pickup is set {f.bufferMinutes} min after your scheduled landing. We
          track your flight. If it's late, your driver waits.
        </Text>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  s,
  last,
}: {
  label: string;
  value: string;
  s: any;
  last?: boolean;
}) {
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    card: {
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
    },
    cardTitle: {
      fontSize: FontSize.xs,
      color: C.muted,
      fontWeight: "600",
      marginBottom: Spacing.md,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
      gap: Spacing.md,
    },
    label: { fontSize: FontSize.sm, color: C.muted },
    value: {
      fontSize: FontSize.sm,
      color: C.white,
      fontWeight: "500",
      flexShrink: 1,
      textAlign: "right",
    },
    meetBox: {
      marginTop: Spacing.md,
      borderWidth: 1,
      borderColor: C.brand + "40",
      backgroundColor: C.brand + "12",
      borderRadius: Radius.md,
      padding: Spacing.md,
    },
    meetLabel: { fontSize: FontSize.xs, color: C.brand, fontWeight: "700" },
    meetName: {
      fontSize: FontSize.sm,
      color: C.white,
      fontWeight: "700",
      marginTop: 2,
    },
    meetText: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 4,
      lineHeight: 18,
    },
    note: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: Spacing.md,
      lineHeight: 18,
    },
  });
