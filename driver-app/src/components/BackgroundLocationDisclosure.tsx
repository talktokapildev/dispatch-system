import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useTheme } from "../lib/ThemeContext";
import { FontSize, Spacing, Radius } from "../lib/theme";

interface Props {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function BackgroundLocationDisclosure({
  visible,
  onAccept,
  onDecline,
}: Props) {
  const { Colors } = useTheme();
  const s = styles(Colors);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Icon */}
          <View style={s.iconContainer}>
            <Text style={s.icon}>📍</Text>
          </View>

          <Text style={s.title}>Background Location Required</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Main disclosure — Google requires this to be prominent */}
            <View style={s.disclosureBox}>
              <Text style={s.disclosureText}>
                OrangeRide Driver collects your location data even when the app
                is closed or not in use.
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
              <Text style={s.bold}>"Allow all the time"</Text> on the next
              screen to enable background tracking.
            </Text>
          </ScrollView>

          {/* Buttons */}
          <TouchableOpacity style={s.acceptBtn} onPress={onAccept}>
            <Text style={s.acceptText}>I understand — Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.declineBtn} onPress={onDecline}>
            <Text style={s.declineText}>Not now</Text>
          </TouchableOpacity>
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
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      paddingBottom: 36,
      maxHeight: "85%",
    },
    iconContainer: {
      alignSelf: "center",
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: C.brand + "20",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.md,
    },
    icon: { fontSize: 32 },
    title: {
      fontSize: FontSize.xl,
      fontWeight: "700",
      color: C.text,
      textAlign: "center",
      marginBottom: Spacing.md,
    },
    disclosureBox: {
      backgroundColor: C.brand + "15",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "40",
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    disclosureText: {
      fontSize: FontSize.sm,
      color: C.text,
      fontWeight: "600",
      textAlign: "center",
      lineHeight: 20,
    },
    bodyText: {
      fontSize: FontSize.sm,
      color: C.muted,
      marginBottom: Spacing.md,
      lineHeight: 20,
    },
    bulletList: { marginBottom: Spacing.md },
    bulletRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      marginBottom: 6,
    },
    bullet: { fontSize: FontSize.sm, color: C.brand, fontWeight: "700" },
    bulletText: {
      flex: 1,
      fontSize: FontSize.sm,
      color: C.muted,
      lineHeight: 20,
    },
    bold: { fontWeight: "700", color: C.text },
    acceptBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: Spacing.md,
    },
    acceptText: {
      color: "#fff",
      fontSize: FontSize.md,
      fontWeight: "700",
    },
    declineBtn: {
      paddingVertical: 12,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    declineText: {
      color: C.muted,
      fontSize: FontSize.sm,
    },
  });
