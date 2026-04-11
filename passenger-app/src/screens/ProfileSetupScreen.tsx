import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, useAuthStore } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

export default function ProfileSetupScreen() {
  const { Colors } = useTheme();
  const { user, setAuth, token, passenger } = useAuthStore();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid = firstName.trim().length >= 1 && lastName.trim().length >= 1;

  const save = async () => {
    if (!isValid) return;
    setLoading(true);
    try {
      const { data } = await api.patch("/passengers/profile", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      // Update the local auth store with the new name so the rest of
      // the app (HomeScreen greeting, ProfileScreen) reflects it immediately
      if (user && token) {
        setAuth(
          token,
          { ...user, firstName: firstName.trim(), lastName: lastName.trim() },
          passenger
        );
      }
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Could not save profile"
      );
    } finally {
      setLoading(false);
    }
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={s.inner}
      >
        {/* Icon */}
        <View style={s.iconWrap}>
          <Text style={s.icon}>👋</Text>
        </View>

        <Text style={s.title}>Welcome to OrangeRide</Text>
        <Text style={s.subtitle}>
          Let us know your name so your driver knows who to look for.
        </Text>

        <View style={s.card}>
          <Text style={s.label}>First name</Text>
          <TextInput
            style={s.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="e.g. Sarah"
            placeholderTextColor={Colors.muted}
            autoFocus
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={s.label}>Last name</Text>
          <TextInput
            style={s.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="e.g. Johnson"
            placeholderTextColor={Colors.muted}
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={save}
          />

          <TouchableOpacity
            style={[s.btn, (!isValid || loading) && s.btnDisabled]}
            onPress={save}
            disabled={!isValid || loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={s.btnText}>Continue →</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={s.note}>
          Your name is only shared with your assigned driver.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    inner: { flex: 1, justifyContent: "center", padding: Spacing.lg },
    iconWrap: { alignItems: "center", marginBottom: Spacing.lg },
    icon: { fontSize: 56 },
    title: {
      fontSize: FontSize.xxl,
      fontWeight: "800",
      color: C.white,
      textAlign: "center",
      marginBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: C.muted,
      textAlign: "center",
      marginBottom: Spacing.xl,
      lineHeight: 20,
    },
    card: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
    },
    label: {
      fontSize: FontSize.xs,
      color: C.muted,
      fontWeight: "600",
      marginBottom: 6,
      marginTop: Spacing.sm,
    },
    input: {
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      color: C.text,
      fontSize: FontSize.md,
      marginBottom: Spacing.sm,
    },
    btn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    btnDisabled: { opacity: 0.4 },
    btnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    note: {
      fontSize: FontSize.xs,
      color: C.muted,
      textAlign: "center",
      marginTop: Spacing.lg,
    },
  });
