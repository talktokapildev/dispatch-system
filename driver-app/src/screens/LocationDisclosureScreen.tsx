import React, { useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

export const DISCLOSURE_ACCEPTED_KEY = "bg_location_disclosure_accepted";

export default function LocationDisclosureScreen({ navigation, route }: any) {
  const { Colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleAccept = async () => {
    try {
      await AsyncStorage.setItem(DISCLOSURE_ACCEPTED_KEY, "true");
    } catch {}
    route.params?.onAccepted?.();
  };

  const handleDecline = () => {
    Alert.alert(
      "Location Required",
      "Background location access is required to receive job assignments and track trips. You cannot use the OrangeRide Driver app without granting this permission.",
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Accept",
          onPress: handleAccept,
        },
      ]
    );
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <Animated.View style={[s.inner, { opacity: fadeAnim }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
        >
          {/* Icon */}
          <View style={s.iconContainer}>
            <Text style={s.icon}>📍</Text>
          </View>

          <Text style={s.title}>Background Location Required</Text>

          {/* Main disclosure — Google Play prominent disclosure requirement */}
          <View style={s.disclosureBox}>
            <Text style={s.disclosureText}>
              OrangeRide Driver collects your location data even when the app is
              closed or not in use.
            </Text>
          </View>

          <Text style={s.bodyText}>This is required so that:</Text>

          <View style={s.bulletList}>
            {[
              "The dispatch system can assign you nearby jobs",
              "Passengers can track your live location during a trip",
              "Your route is recorded for TfL compliance purposes",
              "Location updates continue when you switch to another app",
            ].map((item, i) => (
              <View key={i} style={s.bulletRow}>
                <Text style={s.bullet}>•</Text>
                <Text style={s.bulletText}>{item}</Text>
              </View>
            ))}
          </View>

          <Text style={s.bodyText}>
            Location data is only collected while you are set to{" "}
            <Text style={s.bold}>Available</Text> or{" "}
            <Text style={s.bold}>On Job</Text>. It is never collected when you
            are offline.
          </Text>

          <Text style={s.bodyText}>
            You will be asked to select{" "}
            <Text style={s.bold}>"Allow all the time"</Text> on the next screen
            to enable background tracking.
          </Text>

          <Text style={s.bodyText}>
            This data is processed in accordance with our Privacy Policy and is
            only used to operate the OrangeRide Driver service.
          </Text>
        </ScrollView>

        {/* Action buttons — fixed at bottom */}
        <View style={s.footer}>
          <TouchableOpacity style={s.acceptBtn} onPress={handleAccept}>
            <Text style={s.acceptText}>I understand — Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.declineBtn} onPress={handleDecline}>
            <Text style={s.declineText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    inner: { flex: 1 },
    scroll: {
      padding: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    iconContainer: {
      alignSelf: "center",
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: C.brand + "20",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.lg,
      marginTop: Spacing.lg,
    },
    icon: { fontSize: 36 },
    title: {
      fontSize: FontSize.xxl,
      fontWeight: "800",
      color: C.text,
      textAlign: "center",
      marginBottom: Spacing.lg,
    },
    disclosureBox: {
      backgroundColor: C.brand + "15",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "40",
      padding: Spacing.md,
      marginBottom: Spacing.lg,
    },
    disclosureText: {
      fontSize: FontSize.md,
      color: C.text,
      fontWeight: "600",
      textAlign: "center",
      lineHeight: 24,
    },
    bodyText: {
      fontSize: FontSize.sm,
      color: C.muted,
      marginBottom: Spacing.md,
      lineHeight: 22,
    },
    bulletList: { marginBottom: Spacing.md },
    bulletRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      marginBottom: 8,
    },
    bullet: { fontSize: FontSize.sm, color: C.brand, fontWeight: "700" },
    bulletText: {
      flex: 1,
      fontSize: FontSize.sm,
      color: C.muted,
      lineHeight: 22,
    },
    bold: { fontWeight: "700", color: C.text },
    footer: {
      padding: Spacing.lg,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: C.border,
    },
    acceptBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      paddingVertical: 16,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    acceptText: {
      color: "#000",
      fontSize: FontSize.md,
      fontWeight: "800",
    },
    declineBtn: {
      paddingVertical: 12,
      alignItems: "center",
    },
    declineText: {
      color: C.muted,
      fontSize: FontSize.sm,
    },
  });
