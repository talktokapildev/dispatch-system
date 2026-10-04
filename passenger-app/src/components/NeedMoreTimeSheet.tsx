// passenger-app/src/components/NeedMoreTimeSheet.tsx
//
// "Need more time?" — move an airport pickup LATER than the calculated time.
// Never earlier: the backend rejects pickups before landing + buffer anyway.
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Platform,
  Alert,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { ukTime } from "../lib/airport";

type Props = {
  visible: boolean;
  earliest: Date; // landing + buffer
  landingUtc: string;
  onSelect: (choice: { extraMinutes: number } | { custom: Date }) => void;
  onClose: () => void;
};

const OPTIONS = [15, 30, 60];

export default function NeedMoreTimeSheet({
  visible,
  earliest,
  landingUtc,
  onSelect,
  onClose,
}: Props) {
  const { Colors } = useTheme();
  const s = styles(Colors);
  const [picking, setPicking] = useState(false);
  const [iosTemp, setIosTemp] = useState<Date>(earliest);

  const applyCustom = (d: Date) => {
    let chosen = new Date(d);
    chosen.setSeconds(0, 0);
    // Android time dialog only gives a time of day: if it falls before the
    // earliest pickup but is clearly "after midnight", move it to the next day.
    if (
      chosen < earliest &&
      earliest.getTime() - chosen.getTime() > 12 * 3_600_000
    ) {
      chosen = new Date(chosen.getTime() + 24 * 3_600_000);
    }
    if (chosen < earliest) {
      Alert.alert(
        "Too early",
        `The earliest pickup for this flight is ${ukTime(earliest)}.`
      );
      return;
    }
    setPicking(false);
    onSelect({ custom: chosen });
  };

  const onAndroidTime = (event: DateTimePickerEvent, selected?: Date) => {
    setPicking(false);
    if (event.type === "dismissed" || !selected) return;
    const combined = new Date(earliest);
    combined.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    applyCustom(combined);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.title}>Need more time?</Text>
          <Text style={s.sub}>
            Your flight lands {ukTime(landingUtc)} (UK time). Pickup can be
            moved later, never earlier than {ukTime(earliest)}.
          </Text>

          {!picking && (
            <>
              <View style={s.grid}>
                {OPTIONS.map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={s.option}
                    onPress={() => onSelect({ extraMinutes: m })}
                    activeOpacity={0.85}
                  >
                    <Text style={s.optionMain}>
                      {m === 60 ? "+1 hour" : `+${m} min`}
                    </Text>
                    <Text style={s.optionSub}>
                      {ukTime(new Date(earliest.getTime() + m * 60_000))}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={s.option}
                  onPress={() => {
                    setIosTemp(earliest);
                    setPicking(true);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.optionMain}>Pick a time</Text>
                  <Text style={s.optionSub}>Later than {ukTime(earliest)}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={s.keepBtn}
                onPress={() => onSelect({ extraMinutes: 0 })}
                activeOpacity={0.85}
              >
                <Text style={s.keepText}>Keep {ukTime(earliest)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={s.cancel}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {picking && Platform.OS === "android" && (
            <DateTimePicker
              value={earliest}
              mode="time"
              is24Hour
              onChange={onAndroidTime}
            />
          )}

          {picking && Platform.OS === "ios" && (
            <View>
              <DateTimePicker
                value={iosTemp}
                mode="datetime"
                display="spinner"
                minimumDate={earliest}
                onChange={(_e: DateTimePickerEvent, d?: Date) =>
                  d && setIosTemp(d)
                }
                style={{ height: 200 }}
              />
              <View style={s.pickRow}>
                <TouchableOpacity onPress={() => setPicking(false)}>
                  <Text style={s.cancelText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => applyCustom(iosTemp)}>
                  <Text style={s.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      padding: Spacing.lg,
      paddingBottom: Spacing.xl,
    },
    title: { fontSize: FontSize.md, color: C.white, fontWeight: "700" },
    sub: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 4,
      marginBottom: Spacing.md,
      lineHeight: 18,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
    option: {
      width: "48%",
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      backgroundColor: C.inputBg,
    },
    optionMain: { fontSize: FontSize.sm, color: C.white, fontWeight: "700" },
    optionSub: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    keepBtn: {
      marginTop: Spacing.md,
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
    },
    keepText: { color: "#000", fontWeight: "800", fontSize: FontSize.sm },
    cancel: { alignItems: "center", marginTop: Spacing.md },
    cancelText: { color: C.muted, fontSize: FontSize.sm },
    pickRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: Spacing.sm,
    },
    doneText: { color: C.brand, fontSize: FontSize.sm, fontWeight: "700" },
  });
