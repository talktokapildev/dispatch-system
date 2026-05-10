// driver-app/src/screens/DriverApplicationScreen.tsx
// Step 1 of the self-onboarding flow.
// Collects personal, licence, and vehicle details then POSTs to /driver-applications.
// On success → stores applicationId in AsyncStorage → navigates to DocumentUploadScreen.

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { APPLICATION_ID_KEY } from "./LoginScreen";

type Step = 1 | 2;

const EMPTY_FORM = {
  // Personal
  name: "",
  phone: "+44",
  email: "",
  // Licence
  pcoBadgeNumber: "",
  pcoBadgeExpiry: "", // YYYY-MM-DD
  drivingLicenceNumber: "",
  // Vehicle
  vehicleMake: "",
  vehicleModel: "",
  vehicleReg: "",
  vehicleYear: "",
  vehicleColour: "",
};

export default function DriverApplicationScreen() {
  const { Colors, theme } = useTheme();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validateStep1 = () => {
    if (!form.name.trim()) return "Please enter your full name";
    if (form.phone.length < 13) return "Please enter a valid UK phone number";
    if (!form.pcoBadgeNumber.trim())
      return "Please enter your PCO badge number";
    if (!form.pcoBadgeExpiry.trim())
      return "Please enter your PCO badge expiry date";
    if (!form.drivingLicenceNumber.trim())
      return "Please enter your driving licence number";
    return null;
  };

  const validateStep2 = () => {
    if (!form.vehicleMake.trim()) return "Please enter vehicle make";
    if (!form.vehicleModel.trim()) return "Please enter vehicle model";
    if (!form.vehicleReg.trim()) return "Please enter vehicle registration";
    if (!form.vehicleYear.trim()) return "Please enter vehicle year";
    if (!form.vehicleColour.trim()) return "Please enter vehicle colour";
    const year = parseInt(form.vehicleYear);
    if (isNaN(year) || year < 2000 || year > new Date().getFullYear() + 1)
      return "Please enter a valid vehicle year";
    return null;
  };

  const handleNext = () => {
    const error = validateStep1();
    if (error) {
      Alert.alert("Missing information", error);
      return;
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    const error = validateStep2();
    if (error) {
      Alert.alert("Missing information", error);
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("/driver-applications", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        pcoBadgeNumber: form.pcoBadgeNumber.trim().toUpperCase(),
        pcoBadgeExpiry: form.pcoBadgeExpiry.trim(),
        drivingLicenceNumber: form.drivingLicenceNumber.trim().toUpperCase(),
        vehicleMake: form.vehicleMake.trim(),
        vehicleModel: form.vehicleModel.trim(),
        vehicleReg: form.vehicleReg.trim().toUpperCase().replace(/\s/g, ""),
        vehicleYear: parseInt(form.vehicleYear),
        vehicleColour: form.vehicleColour.trim(),
      });

      const applicationId = data.applicationId;
      await AsyncStorage.setItem(APPLICATION_ID_KEY, applicationId);

      navigation.replace("DocumentUpload", { applicationId });
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Submission failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => (step === 2 ? setStep(1) : navigation.goBack())}
            style={s.backBtn}
          >
            <Text style={s.backText}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Apply to Drive</Text>
            <Text style={s.headerSub}>
              {step === 1 ? "Your details" : "Your vehicle"}
            </Text>
          </View>
          {/* Step indicator */}
          <View style={s.stepRow}>
            <View style={[s.stepDot, step >= 1 && s.stepDotActive]} />
            <View style={[s.stepLine]} />
            <View style={[s.stepDot, step >= 2 && s.stepDotActive]} />
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 ? (
            <>
              {/* Personal details */}
              <Text style={s.sectionLabel}>Personal Details</Text>

              <Text style={s.fieldLabel}>
                Full Name <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={s.input}
                value={form.name}
                onChangeText={set("name")}
                placeholder="John Smith"
                placeholderTextColor={Colors.muted}
                autoCapitalize="words"
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              <Text style={s.fieldLabel}>
                Mobile Number <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={s.input}
                value={form.phone}
                onChangeText={set("phone")}
                keyboardType="phone-pad"
                placeholder="+447123456789"
                placeholderTextColor={Colors.muted}
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              <Text style={s.fieldLabel}>Email (optional)</Text>
              <TextInput
                style={s.input}
                value={form.email}
                onChangeText={set("email")}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="john@example.com"
                placeholderTextColor={Colors.muted}
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              {/* Licence details */}
              <Text style={[s.sectionLabel, { marginTop: Spacing.lg }]}>
                Licence Details
              </Text>

              <Text style={s.fieldLabel}>
                PCO Badge Number <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={[s.input, s.mono]}
                value={form.pcoBadgeNumber}
                onChangeText={set("pcoBadgeNumber")}
                autoCapitalize="characters"
                placeholder="PCO123456"
                placeholderTextColor={Colors.muted}
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              <Text style={s.fieldLabel}>
                PCO Badge Expiry <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={[s.input, s.mono]}
                value={form.pcoBadgeExpiry}
                onChangeText={set("pcoBadgeExpiry")}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.muted}
                keyboardType="numbers-and-punctuation"
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              <Text style={s.fieldLabel}>
                Driving Licence Number <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={[s.input, s.mono]}
                value={form.drivingLicenceNumber}
                onChangeText={set("drivingLicenceNumber")}
                autoCapitalize="characters"
                placeholder="SMITH123456AB9CD"
                placeholderTextColor={Colors.muted}
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              <TouchableOpacity style={s.btn} onPress={handleNext}>
                <Text style={s.btnText}>Next: Vehicle Details →</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.sectionLabel}>Vehicle Details</Text>

              <View style={s.row}>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>
                    Make <Text style={s.required}>*</Text>
                  </Text>
                  <TextInput
                    style={s.input}
                    value={form.vehicleMake}
                    onChangeText={set("vehicleMake")}
                    placeholder="Toyota"
                    placeholderTextColor={Colors.muted}
                    autoCapitalize="words"
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>
                    Model <Text style={s.required}>*</Text>
                  </Text>
                  <TextInput
                    style={s.input}
                    value={form.vehicleModel}
                    onChangeText={set("vehicleModel")}
                    placeholder="Prius"
                    placeholderTextColor={Colors.muted}
                    autoCapitalize="words"
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
              </View>

              <Text style={s.fieldLabel}>
                Registration <Text style={s.required}>*</Text>
              </Text>
              <TextInput
                style={[s.input, s.mono]}
                value={form.vehicleReg}
                onChangeText={set("vehicleReg")}
                autoCapitalize="characters"
                placeholder="AB12 CDE"
                placeholderTextColor={Colors.muted}
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />

              <View style={s.row}>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>
                    Year <Text style={s.required}>*</Text>
                  </Text>
                  <TextInput
                    style={s.input}
                    value={form.vehicleYear}
                    onChangeText={set("vehicleYear")}
                    keyboardType="number-pad"
                    placeholder="2022"
                    placeholderTextColor={Colors.muted}
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>
                    Colour <Text style={s.required}>*</Text>
                  </Text>
                  <TextInput
                    style={s.input}
                    value={form.vehicleColour}
                    onChangeText={set("vehicleColour")}
                    placeholder="Black"
                    placeholderTextColor={Colors.muted}
                    autoCapitalize="words"
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[s.btn, loading && s.btnDisabled]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={s.btnText}>Submit & Upload Documents →</Text>
                )}
              </TouchableOpacity>

              <Text style={s.footerNote}>
                By submitting you confirm your details are accurate. Your
                application will be reviewed by our team.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
      gap: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    backBtn: { padding: Spacing.xs },
    backText: { fontSize: FontSize.xl, color: C.muted },
    headerTitle: { fontSize: FontSize.lg, fontWeight: "700", color: C.text },
    headerSub: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    stepDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: C.border,
    },
    stepDotActive: { backgroundColor: C.brand },
    stepLine: { width: 16, height: 2, backgroundColor: C.border },
    scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
    sectionLabel: {
      fontSize: FontSize.xs,
      color: C.muted,
      textTransform: "uppercase",
      letterSpacing: 1.2,
      marginBottom: Spacing.md,
    },
    fieldLabel: { fontSize: FontSize.sm, color: C.muted, marginBottom: 6 },
    required: { color: "#ef4444" },
    input: {
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      color: C.text,
      fontSize: FontSize.md,
      marginBottom: Spacing.md,
    },
    mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
    row: { flexDirection: "row", gap: Spacing.sm },
    col: { flex: 1 },
    btn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#000", fontWeight: "700", fontSize: FontSize.md },
    footerNote: {
      fontSize: FontSize.xs,
      color: C.muted,
      textAlign: "center",
      marginTop: Spacing.lg,
      lineHeight: 18,
    },
  });
