// passenger-app/src/components/AirportPickupInfo.tsx
//
// Flight + meeting point directions on the Tracking screen, so the passenger
// has them to hand after landing.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { TERMINAL_LABEL } from "../lib/airport";

export default function AirportPickupInfo({ booking }: { booking: any }) {
  const { Colors } = useTheme();
  const s = styles(Colors);
  const mp = booking?.meetingPoint;
  if (!booking?.meetingPointId && !mp) return null;

  const terminal = booking.terminal
    ? TERMINAL_LABEL[booking.terminal] ?? booking.terminal
    : null;

  return (
    <View style={s.box}>
      {booking.flightNumber && (
        <Text style={s.flight}>
          ✈ {booking.flightNumber}
          {terminal ? ` · ${terminal}` : ""}
        </Text>
      )}
      <Text style={s.label}>Meet your driver</Text>
      <Text style={s.name}>{mp?.name ?? booking.pickupAddress}</Text>
      {mp?.instructions && <Text style={s.text}>{mp.instructions}</Text>}
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    box: {
      borderWidth: 1,
      borderColor: C.brand + "40",
      backgroundColor: C.brand + "12",
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    flight: {
      fontSize: FontSize.sm,
      color: C.white,
      fontWeight: "700",
      marginBottom: Spacing.sm,
    },
    label: { fontSize: FontSize.xs, color: C.brand, fontWeight: "700" },
    name: {
      fontSize: FontSize.sm,
      color: C.white,
      fontWeight: "700",
      marginTop: 2,
    },
    text: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 4,
      lineHeight: 18,
    },
  });
