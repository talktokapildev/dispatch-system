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
  Modal,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { format } from "date-fns";
import { useNavigation } from "@react-navigation/native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { APPLICATION_ID_KEY } from "./LoginScreen";

type Step = 1 | 2;

const VEHICLE_CLASSES = ["STANDARD", "EXECUTIVE", "MPV", "MINIBUS"];
const EMISSION_STANDARDS = [
  "Euro 4",
  "Euro 5",
  "Euro 6",
  "Electric",
  "Hybrid",
  "Plug-in Hybrid",
];

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
  // Vehicle classification & compliance
  vehicleClass: "STANDARD",
  vehicleSeats: "4",
  vehiclePhvLicenceNumber: "",
  vehiclePhvLicenceExpiry: "", // YYYY-MM-DD
  vehiclePhvDiscNumber: "",
  vehicleEmissionStandard: "",
};

export default function DriverApplicationScreen() {
  const { Colors, theme } = useTheme();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  // PCO expiry date picker state
  const [showPcoDatePicker, setShowPcoDatePicker] = useState(false);
  const [pcoTempDate, setPcoTempDate] = useState<Date>(new Date());

  // PHV licence expiry date picker state
  const [showPhvDatePicker, setShowPhvDatePicker] = useState(false);
  const [phvTempDate, setPhvTempDate] = useState<Date>(new Date());

  // ULEZ compliant toggle (boolean, not string)
  const [isUlezCompliant, setIsUlezCompliant] = useState(false);

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const openPcoPicker = () => {
    setPcoTempDate(
      form.pcoBadgeExpiry ? new Date(form.pcoBadgeExpiry) : new Date()
    );
    setShowPcoDatePicker(true);
  };

  const confirmPcoDate = (date: Date) => {
    set("pcoBadgeExpiry")(format(date, "yyyy-MM-dd"));
    setShowPcoDatePicker(false);
  };

  const openPhvPicker = () => {
    setPhvTempDate(
      form.vehiclePhvLicenceExpiry
        ? new Date(form.vehiclePhvLicenceExpiry)
        : new Date()
    );
    setShowPhvDatePicker(true);
  };

  const confirmPhvDate = (date: Date) => {
    set("vehiclePhvLicenceExpiry")(format(date, "yyyy-MM-dd"));
    setShowPhvDatePicker(false);
  };

  const openClassPicker = () => {
    Alert.alert("Vehicle Class", "Select vehicle class", [
      ...VEHICLE_CLASSES.map((c) => ({
        text: c,
        onPress: () => set("vehicleClass")(c),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const openEmissionPicker = () => {
    Alert.alert("Emission Standard", "Select emission standard", [
      {
        text: "Not specified",
        onPress: () => set("vehicleEmissionStandard")(""),
      },
      ...EMISSION_STANDARDS.map((e) => ({
        text: e,
        onPress: () => set("vehicleEmissionStandard")(e),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const validateStep1 = () => {
    if (!form.name.trim()) return "Please enter your full name";
    if (form.phone.length < 13) return "Please enter a valid UK phone number";
    if (!form.pcoBadgeNumber.trim())
      return "Please enter your PCO badge number";
    if (!form.pcoBadgeExpiry.trim())
      return "Please select your PCO badge expiry date";
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
        vehicleClass: form.vehicleClass,
        vehicleSeats: parseInt(form.vehicleSeats) || 4,
        vehiclePhvLicenceNumber:
          form.vehiclePhvLicenceNumber.trim() || undefined,
        vehiclePhvLicenceExpiry: form.vehiclePhvLicenceExpiry || undefined,
        vehiclePhvDiscNumber: form.vehiclePhvDiscNumber.trim() || undefined,
        vehicleEmissionStandard: form.vehicleEmissionStandard || undefined,
        vehicleIsUlezCompliant: isUlezCompliant,
      });

      const applicationId = data.applicationId;
      await AsyncStorage.setItem(APPLICATION_ID_KEY, applicationId);

      // navigate (not replace) so back button works from DocumentUpload
      navigation.navigate("DocumentUpload", { applicationId });
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
            <View style={s.stepLine} />
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
              {/* ── Personal details ── */}
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

              {/* ── Licence details ── */}
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
              <TouchableOpacity
                style={[s.input, s.dateBtn]}
                onPress={openPcoPicker}
                activeOpacity={0.7}
              >
                <Text
                  style={
                    form.pcoBadgeExpiry
                      ? s.dateBtnValueText
                      : s.dateBtnPlaceholderText
                  }
                >
                  {form.pcoBadgeExpiry
                    ? format(new Date(form.pcoBadgeExpiry), "dd MMM yyyy")
                    : "Select expiry date"}
                </Text>
                <Text style={s.dateBtnIcon}>📅</Text>
              </TouchableOpacity>

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
              {/* ── Vehicle details ── */}
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

              {/* ── Vehicle Classification ── */}
              <Text style={[s.sectionLabel, { marginTop: Spacing.lg }]}>
                Classification
              </Text>

              <View style={s.row}>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>
                    Class <Text style={s.required}>*</Text>
                  </Text>
                  <TouchableOpacity
                    style={[s.input, s.dateBtn]}
                    onPress={openClassPicker}
                    activeOpacity={0.7}
                  >
                    <Text style={s.dateBtnValueText}>{form.vehicleClass}</Text>
                    <Text style={s.dateBtnIcon}>›</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>Seats</Text>
                  <TextInput
                    style={s.input}
                    value={form.vehicleSeats}
                    onChangeText={set("vehicleSeats")}
                    keyboardType="number-pad"
                    placeholder="4"
                    placeholderTextColor={Colors.muted}
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
              </View>

              {/* ── PHV Details ── */}
              <Text style={[s.sectionLabel, { marginTop: Spacing.lg }]}>
                PHV Details
              </Text>

              <View style={s.row}>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>PHV Licence No.</Text>
                  <TextInput
                    style={[s.input, s.mono]}
                    value={form.vehiclePhvLicenceNumber}
                    onChangeText={set("vehiclePhvLicenceNumber")}
                    autoCapitalize="characters"
                    placeholder="452689"
                    placeholderTextColor={Colors.muted}
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
                <View style={s.col}>
                  <Text style={s.fieldLabel}>PHV Disc No.</Text>
                  <TextInput
                    style={[s.input, s.mono]}
                    value={form.vehiclePhvDiscNumber}
                    onChangeText={set("vehiclePhvDiscNumber")}
                    autoCapitalize="characters"
                    placeholder="1087796"
                    placeholderTextColor={Colors.muted}
                    keyboardAppearance={theme === "dark" ? "dark" : "light"}
                  />
                </View>
              </View>

              <Text style={s.fieldLabel}>PHV Licence Expiry</Text>
              <TouchableOpacity
                style={[s.input, s.dateBtn]}
                onPress={openPhvPicker}
                activeOpacity={0.7}
              >
                <Text
                  style={
                    form.vehiclePhvLicenceExpiry
                      ? s.dateBtnValueText
                      : s.dateBtnPlaceholderText
                  }
                >
                  {form.vehiclePhvLicenceExpiry
                    ? format(
                        new Date(form.vehiclePhvLicenceExpiry),
                        "dd MMM yyyy"
                      )
                    : "Select expiry date"}
                </Text>
                <Text style={s.dateBtnIcon}>📅</Text>
              </TouchableOpacity>

              {/* ── Emissions & ULEZ ── */}
              <Text style={[s.sectionLabel, { marginTop: Spacing.lg }]}>
                Emissions & ULEZ
              </Text>

              <Text style={s.fieldLabel}>Emission Standard</Text>
              <TouchableOpacity
                style={[s.input, s.dateBtn]}
                onPress={openEmissionPicker}
                activeOpacity={0.7}
              >
                <Text
                  style={
                    form.vehicleEmissionStandard
                      ? s.dateBtnValueText
                      : s.dateBtnPlaceholderText
                  }
                >
                  {form.vehicleEmissionStandard || "Not specified"}
                </Text>
                <Text style={s.dateBtnIcon}>›</Text>
              </TouchableOpacity>

              <View style={s.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>ULEZ Compliant</Text>
                  <Text style={s.toggleHint}>
                    Required for operating in the London Ultra Low Emission Zone
                  </Text>
                </View>
                <Switch
                  value={isUlezCompliant}
                  onValueChange={setIsUlezCompliant}
                  trackColor={{ false: Colors.border, true: Colors.brand }}
                  thumbColor="#fff"
                />
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

      {/* ── iOS PCO Date Picker Modal ── */}
      {Platform.OS === "ios" && showPcoDatePicker && (
        <Modal transparent animationType="slide">
          <View style={s.dateOverlay}>
            <View style={s.dateSheet}>
              <View style={s.dateSheetHeader}>
                <TouchableOpacity onPress={() => setShowPcoDatePicker(false)}>
                  <Text style={s.dateCancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={s.dateTitleText}>PCO Badge Expiry</Text>
                <TouchableOpacity onPress={() => confirmPcoDate(pcoTempDate)}>
                  <Text style={s.dateDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pcoTempDate}
                mode="date"
                display="spinner"
                onChange={(_, date) => {
                  if (date) setPcoTempDate(date);
                }}
                minimumDate={new Date()}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* ── Android PCO Date Picker ── */}
      {Platform.OS === "android" && showPcoDatePicker && (
        <DateTimePicker
          value={pcoTempDate}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowPcoDatePicker(false);
            if (event.type !== "dismissed" && date) confirmPcoDate(date);
          }}
          minimumDate={new Date()}
        />
      )}

      {/* ── iOS PHV Date Picker Modal ── */}
      {Platform.OS === "ios" && showPhvDatePicker && (
        <Modal transparent animationType="slide">
          <View style={s.dateOverlay}>
            <View style={s.dateSheet}>
              <View style={s.dateSheetHeader}>
                <TouchableOpacity onPress={() => setShowPhvDatePicker(false)}>
                  <Text style={s.dateCancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={s.dateTitleText}>PHV Licence Expiry</Text>
                <TouchableOpacity onPress={() => confirmPhvDate(phvTempDate)}>
                  <Text style={s.dateDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={phvTempDate}
                mode="date"
                display="spinner"
                onChange={(_, date) => {
                  if (date) setPhvTempDate(date);
                }}
                minimumDate={new Date()}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* ── Android PHV Date Picker ── */}
      {Platform.OS === "android" && showPhvDatePicker && (
        <DateTimePicker
          value={phvTempDate}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowPhvDatePicker(false);
            if (event.type !== "dismissed" && date) confirmPhvDate(date);
          }}
          minimumDate={new Date()}
        />
      )}
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

    // Date picker button (replaces TextInput for PCO expiry)
    dateBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dateBtnValueText: { fontSize: FontSize.md, color: C.text },
    dateBtnPlaceholderText: { fontSize: FontSize.md, color: C.muted },
    dateBtnIcon: { fontSize: 18 },

    // iOS date picker bottom sheet
    dateOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    dateSheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingBottom: Spacing.xl,
    },
    dateSheetHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    dateCancelText: {
      fontSize: FontSize.sm,
      color: C.muted,
      fontWeight: "600",
    },
    dateTitleText: { fontSize: FontSize.sm, color: C.text, fontWeight: "700" },
    dateDoneText: { fontSize: FontSize.sm, color: C.brand, fontWeight: "700" },

    // Toggle row (ULEZ)
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      gap: Spacing.md,
    },
    toggleHint: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 2,
      lineHeight: 16,
    },
  });
