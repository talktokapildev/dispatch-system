import React, { useState, useRef, useEffect } from "react";
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
import CountryPicker from "../components/CountryPicker";
import {
  defaultPhoneCountry,
  findCountry,
  formatInternational,
  rememberPhoneCountry,
  toE164,
  type PhoneCountry,
  PHONE_COUNTRIES,
} from "../lib/phoneCountries";

type Step = "phone" | "otp";

export default function LoginScreen() {
  const { Colors } = useTheme();
  const [step, setStep] = useState<Step>("phone");
  // Country picker defaults to: last country used on this phone → phone's region → UK.
  const [country, setCountry] = useState<PhoneCountry>(PHONE_COUNTRIES[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [number, setNumber] = useState(""); // as typed, without the country code
  const [phone, setPhone] = useState(""); // E.164 sent to the API, e.g. +447398341839
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const otpRef = useRef<TextInput>(null);

  useEffect(() => {
    defaultPhoneCountry().then(setCountry);
  }, []);

  const sendOtp = async () => {
    const parsed = toE164(country, number);
    if (!parsed) {
      Alert.alert(
        "Invalid number",
        `Please check your mobile number for ${country.name} (${country.dial}).`
      );
      return;
    }
    // A pasted "+…" number may be from another country: show that flag from now on.
    const typedCountry = findCountry(parsed.country);
    if (typedCountry && typedCountry.code !== country.code) setCountry(typedCountry);
    setPhone(parsed.e164);
    setLoading(true);
    try {
      const { data } = await api.post("/auth/otp/send", { phone: parsed.e164 });
      // if (data._devCode) Alert.alert('Dev Mode', `Your OTP is: ${data._devCode}`)
      if (data._devCode && process.env.APP_ENV !== "production")
        Alert.alert("Dev Mode", `Your OTP is: ${data._devCode}`);
      setStep("otp");
      setTimeout(() => otpRef.current?.focus(), 300);
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) {
      Alert.alert("Invalid code", "Please enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/otp/verify", {
        phone,
        code: otp,
        requestedRole: "PASSENGER",
      });
      const { token, user } = data.data;
      // sendOtp already switched the flag to the number's country, so remember that one.
      rememberPhoneCountry(country.code);

      if (user.role !== "PASSENGER") {
        Alert.alert("Access Denied", "This app is for passengers only.");
        return;
      }

      // Fetch full passenger profile
      const meRes = await api.get("/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAuth(token, user, meRes.data.data.passenger ?? null);
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error ?? "Invalid code");
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
        <View style={s.logoSection}>
          <View style={s.logoBox}>
            <Text style={s.logoIcon}>🚕</Text>
          </View>
          <Text style={s.appName}>OrangeRide</Text>
          <Text style={s.appSub}>Your private hire, sorted.</Text>
        </View>

        <View style={s.card}>
          {step === "phone" ? (
            <>
              <Text style={s.cardTitle}>Sign in</Text>
              <Text style={s.label}>Mobile number</Text>
              <View style={s.phoneRow}>
                <TouchableOpacity
                  style={s.countryBtn}
                  onPress={() => setPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Country: ${country.name} ${country.dial}. Tap to change`}
                >
                  <Text style={s.countryFlag}>{country.flag}</Text>
                  <Text style={s.countryDial}>{country.dial}</Text>
                  <Text style={s.countryCaret}>▾</Text>
                </TouchableOpacity>
                <TextInput
                  style={[s.input, s.phoneInput]}
                  value={number}
                  onChangeText={setNumber}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  placeholder={country.code === "GB" ? "07123 456789" : "Mobile number"}
                  placeholderTextColor={Colors.muted}
                  autoFocus
                />
              </View>
              <Text style={s.hint}>
                {country.code === "GB"
                  ? "We'll text a verification code to this number"
                  : "We'll text a verification code to this number. Texts abroad can take a minute to arrive."}
              </Text>
              <TouchableOpacity
                style={[s.btn, loading && s.btnDisabled]}
                onPress={sendOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={s.btnText}>Send Code →</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.cardTitle}>Enter your code</Text>
              <Text style={s.phoneDisplay}>Sent to {formatInternational(phone)}</Text>
              <TextInput
                ref={otpRef}
                style={[s.input, s.otpInput]}
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={Colors.muted}
              />
              <TouchableOpacity
                style={[s.btn, loading && s.btnDisabled]}
                onPress={verifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={s.btnText}>Verify & Continue</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setStep("phone");
                  setOtp("");
                }}
                style={s.backBtn}
              >
                <Text style={s.backText}>← Change number</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
      <CountryPicker
        visible={pickerOpen}
        selected={country}
        onSelect={(c) => {
          setCountry(c);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    inner: { flex: 1, justifyContent: "center", padding: Spacing.lg },
    logoSection: { alignItems: "center", marginBottom: Spacing.xxl },
    logoBox: {
      width: 80,
      height: 80,
      borderRadius: Radius.xl,
      backgroundColor: C.brand,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.md,
    },
    logoIcon: { fontSize: 36 },
    appName: { fontSize: FontSize.xxl, fontWeight: "800", color: C.white },
    appSub: { fontSize: FontSize.sm, color: C.muted, marginTop: 4 },
    card: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
    },
    cardTitle: {
      fontSize: FontSize.xl,
      fontWeight: "700",
      color: C.white,
      marginBottom: Spacing.md,
    },
    label: { fontSize: FontSize.sm, color: C.muted, marginBottom: 8 },
    phoneDisplay: { fontSize: FontSize.sm, color: C.brand, marginBottom: 12 },
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
    otpInput: {
      fontSize: FontSize.xxxl,
      textAlign: "center",
      letterSpacing: 12,
      fontWeight: "700",
    },
    hint: { fontSize: FontSize.xs, color: C.muted, marginBottom: Spacing.md },
    phoneRow: { flexDirection: "row", gap: Spacing.sm },
    phoneInput: { flex: 1 },
    countryBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 48,
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
    },
    countryFlag: { fontSize: 22 },
    countryDial: { fontSize: FontSize.md, color: C.text, fontWeight: "600" },
    countryCaret: { fontSize: FontSize.sm, color: C.muted },
    btn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#000", fontWeight: "700", fontSize: FontSize.md },
    backBtn: { alignItems: "center", marginTop: Spacing.md },
    backText: { color: C.muted, fontSize: FontSize.sm },
  });
