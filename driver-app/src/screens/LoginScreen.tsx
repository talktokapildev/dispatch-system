import React, { useState, useRef } from "react";
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

type Step = "phone" | "otp";

export default function LoginScreen({
  onLogin,
}: {
  onLogin?: (token: string) => void;
}) {
  const { Colors, theme } = useTheme();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("+44");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const otpRef = useRef<TextInput>(null);

  const sendOtp = async () => {
    if (phone.length < 13) {
      Alert.alert("Invalid number", "Please enter a valid UK phone number");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/otp/send", { phone });
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
        requestedRole: "DRIVER",
      });
      const { token, user } = data.data;
      if (user.role !== "DRIVER") {
        Alert.alert(
          "Access Denied",
          "This app is for drivers only. Please contact your operator."
        );
        return;
      }
      const driverRes = await api.get("/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAuth(token, user, driverRes.data.data.driver);
      onLogin?.(token);
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error ?? "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={s.inner}
      >
        <View style={s.logoSection}>
          <View style={s.logoBox}>
            <Text style={s.logoIcon}>🚖</Text>
          </View>
          <Text style={s.appName}>OrangeRide Driver</Text>
          <Text style={s.appSub}>TfL Licensed Private Hire</Text>
        </View>

        <View style={s.card}>
          {step === "phone" ? (
            <>
              <Text style={s.label}>Mobile Number</Text>
              <TextInput
                style={s.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+447123456789"
                placeholderTextColor={Colors.muted}
                autoFocus
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />
              <Text style={s.hint}>
                Enter the phone number registered with your operator
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
              <Text style={s.label}>Enter 6-digit code</Text>
              <Text style={s.phoneDisplay}>Sent to {phone}</Text>
              <TextInput
                ref={otpRef}
                style={[s.input, s.otpInput]}
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={Colors.muted}
                keyboardAppearance={theme === "dark" ? "dark" : "light"}
              />
              <TouchableOpacity
                style={[s.btn, loading && s.btnDisabled]}
                onPress={verifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={s.btnText}>Verify & Login</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setStep("phone")}
                style={s.backBtn}
              >
                <Text style={s.backText}>← Change number</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.loginBg },
    inner: { flex: 1, justifyContent: "center", padding: Spacing.lg },
    logoSection: { alignItems: "center", marginBottom: Spacing.xxl },
    logoBox: {
      width: 72,
      height: 72,
      borderRadius: Radius.lg,
      backgroundColor: C.brand,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.md,
    },
    logoIcon: { fontSize: 32 },
    appName: { fontSize: FontSize.xxl, fontWeight: "700", color: C.white },
    appSub: { fontSize: FontSize.sm, color: C.muted, marginTop: 4 },
    card: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
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
