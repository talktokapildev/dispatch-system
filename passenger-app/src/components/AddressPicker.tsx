import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTheme } from "../lib/ThemeContext";
import { FontSize, Spacing, Radius } from "../lib/theme";

const GOOGLE_API_KEY = "AIzaSyAACxY0v2BlKtyW2BnNRjnGpuM1UjrRGWI";

interface Suggestion {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface PlaceResult {
  address: string;
  latitude: number;
  longitude: number;
}

interface AddressPickerProps {
  label: string;
  icon: string;
  placeholder: string;
  value: string;
  onSelect: (result: PlaceResult) => void;
  onClear?: () => void;
}

export default function AddressPicker({
  label,
  icon,
  placeholder,
  value,
  onSelect,
  onClear,
}: AddressPickerProps) {
  const { Colors } = useTheme();
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (text: string) => {
    setQuery(text);
    clearTimeout(debounceRef.current ?? undefined);
    if (text.length < 3) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          text
        )}&key=${GOOGLE_API_KEY}&components=country:gb&language=en`;
        const res = await fetch(url);
        const json = await res.json();
        setSuggestions(json.predictions ?? []);
      } catch {
      } finally {
        setLoading(false);
      }
    }, 350);
  };

  const selectPlace = async (suggestion: Suggestion) => {
    setQuery(suggestion.description);
    setSuggestions([]);
    setFocused(false);
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${suggestion.place_id}&fields=geometry,formatted_address&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const loc = json.result?.geometry?.location;
      if (loc) {
        onSelect({
          address: json.result?.formatted_address ?? suggestion.description,
          latitude: loc.lat,
          longitude: loc.lng,
        });
      }
    } catch {}
  };

  const s = styles(Colors);

  return (
    <View style={s.wrapper}>
      <Text style={s.label}>
        {icon} {label}
      </Text>
      <View style={[s.inputRow, focused && { borderColor: Colors.brand }]}>
        <TextInput
          style={s.input}
          value={query}
          onChangeText={search}
          placeholder={placeholder}
          placeholderTextColor={Colors.muted}
          onFocus={() => setFocused(true)}
          onBlur={() =>
            setTimeout(() => {
              setFocused(false);
              setSuggestions([]);
            }, 200)
          }
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading && (
          <ActivityIndicator
            size="small"
            color={Colors.brand}
            style={{ marginRight: Spacing.sm }}
          />
        )}
        {query.length > 0 && !loading && (
          <TouchableOpacity
            onPress={() => {
              setQuery("");
              setSuggestions([]);
              onClear?.();
            }}
            style={s.clearBtn}
          >
            <Text style={s.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      {suggestions.length > 0 && (
        <View style={s.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.place_id}
            keyboardShouldPersistTaps="always"
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.suggestion}
                onPress={() => selectPlace(item)}
              >
                <Text style={s.suggMain} numberOfLines={1}>
                  {item.structured_formatting.main_text}
                </Text>
                <Text style={s.suggSub} numberOfLines={1}>
                  {item.structured_formatting.secondary_text}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    wrapper: { marginBottom: Spacing.sm },
    label: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginBottom: 6,
      fontWeight: "600",
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      paddingLeft: Spacing.md,
    },
    input: {
      flex: 1,
      color: C.text,
      fontSize: FontSize.md,
      paddingVertical: Spacing.md,
    },
    clearBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
    clearText: { color: C.muted, fontSize: FontSize.sm },
    dropdown: {
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      marginTop: 2,
      overflow: "hidden",
      zIndex: 999,
    },
    suggestion: {
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    suggMain: { fontSize: FontSize.sm, color: C.white, fontWeight: "600" },
    suggSub: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
  });
