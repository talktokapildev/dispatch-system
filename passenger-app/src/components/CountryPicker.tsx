// Full-screen list of sign-in countries with search. Used by LoginScreen.
import React, { useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { PHONE_COUNTRIES, type PhoneCountry } from "../lib/phoneCountries";

type Props = {
  visible: boolean;
  selected: PhoneCountry;
  onSelect: (c: PhoneCountry) => void;
  onClose: () => void;
};

export default function CountryPicker({ visible, selected, onSelect, onClose }: Props) {
  const { Colors } = useTheme();
  const s = styles(Colors);
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return PHONE_COUNTRIES;
    return PHONE_COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        c.dial.slice(1).startsWith(q)
    );
  }, [query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>Choose your country</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" style={s.closeBtn}>
            <Text style={s.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search country or code"
          placeholderTextColor={Colors.muted}
          autoCorrect={false}
        />
        <FlatList
          data={list}
          keyExtractor={(c) => c.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[s.row, item.code === selected.code && s.rowSelected]}
              onPress={() => {
                setQuery("");
                onSelect(item);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} ${item.dial}`}
            >
              <Text style={s.flag}>{item.flag}</Text>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.dial}>{item.dial}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={s.empty}>
              Not listed? Please call or WhatsApp us on +44 7398 341839 to book.
            </Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = (C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    title: { fontSize: FontSize.lg, fontWeight: "700", color: C.white },
    closeBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
    closeText: { color: C.brand, fontSize: FontSize.md, fontWeight: "600" },
    search: {
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      color: C.text,
      fontSize: FontSize.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 52,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: C.border,
    },
    rowSelected: { backgroundColor: C.card },
    flag: { fontSize: 24, width: 40 },
    name: { flex: 1, fontSize: FontSize.md, color: C.text },
    dial: { fontSize: FontSize.md, color: C.muted },
    empty: { padding: Spacing.lg, color: C.muted, fontSize: FontSize.sm },
  });
