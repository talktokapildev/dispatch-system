// passenger-app/src/components/TerminalPicker.tsx
//
// "Which terminal?" chips for airport pickups, plus the meeting point and
// directions for the selected terminal.
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { MeetingPoint, TERMINAL_LABEL } from "../lib/airport";

type Props = {
  meetingPoints: MeetingPoint[];
  selectedId: string | null;
  onSelect: (mp: MeetingPoint) => void;
  title?: string | null; // null hides the title
  compact?: boolean; // one-line meeting point instead of the full directions box
};

export default function TerminalPicker({
  meetingPoints,
  selectedId,
  onSelect,
  title = "Which terminal?",
  compact = false,
}: Props) {
  const { Colors } = useTheme();
  const s = styles(Colors);
  const selected = meetingPoints.find((m) => m.id === selectedId) ?? null;

  return (
    <View>
      {title ? <Text style={s.title}>{title}</Text> : null}
      <View style={s.chipRow}>
        {meetingPoints.map((mp) => {
          const active = mp.id === selectedId;
          return (
            <TouchableOpacity
              key={mp.id}
              style={[s.chip, active && s.chipActive]}
              onPress={() => onSelect(mp)}
              activeOpacity={0.85}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {TERMINAL_LABEL[mp.terminal] ?? mp.terminal}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selected && compact && (
        <Text style={s.meetLine} numberOfLines={1}>
          📍 Meet at <Text style={s.meetLineName}>{selected.name}</Text>
        </Text>
      )}

      {selected && !compact && (
        <View style={s.meetBox}>
          <Text style={s.meetLabel}>Meet your driver</Text>
          <Text style={s.meetName}>{selected.name}</Text>
          <Text style={s.meetInstructions}>{selected.instructions}</Text>
        </View>
      )}
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    title: {
      fontSize: FontSize.sm,
      color: C.white,
      fontWeight: "600",
      marginBottom: Spacing.sm,
    },
    chipRow: { flexDirection: "row", gap: Spacing.sm },
    chip: {
      flex: 1,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      paddingVertical: Spacing.sm,
      alignItems: "center",
      backgroundColor: C.inputBg,
    },
    chipActive: { borderColor: C.brand, backgroundColor: C.brand + "22" },
    chipText: { fontSize: FontSize.sm, color: C.muted, fontWeight: "600" },
    chipTextActive: { color: C.brand },
    meetBox: {
      marginTop: Spacing.sm,
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
    meetLine: { fontSize: FontSize.xs, color: C.muted, marginTop: Spacing.sm },
    meetLineName: { color: C.white, fontWeight: "700" },
    meetInstructions: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 4,
      lineHeight: 18,
    },
  });
