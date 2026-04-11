// ─── JobCompleteScreen.tsx ─────────────────────────────────────────────────
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

export default function JobCompleteScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { booking } = route.params;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const fare = booking?.actualFare ?? booking?.estimatedFare ?? 0;
  const driverEarning = fare * 0.85;
  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <Animated.View
          style={[
            s.checkCircle,
            { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
          ]}
        >
          <Text style={s.checkIcon}>✓</Text>
        </Animated.View>
        <Text style={s.title}>Trip Complete!</Text>
        <Text style={s.subtitle}>
          Great job. Your payment is being processed.
        </Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Trip Fare</Text>
            <Text style={s.rowValue}>£{fare.toFixed(2)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Platform Fee (15%)</Text>
            <Text style={[s.rowValue, { color: Colors.muted }]}>
              -£{(fare * 0.15).toFixed(2)}
            </Text>
          </View>
          <View style={[s.row, s.totalRow]}>
            <Text style={s.totalLabel}>Your Earnings</Text>
            <Text style={s.totalValue}>£{driverEarning.toFixed(2)}</Text>
          </View>
        </View>
        <View style={s.refCard}>
          <Text style={s.refLabel}>Reference</Text>
          <Text style={s.refValue}>{booking?.reference}</Text>
        </View>
        <TouchableOpacity
          style={s.doneBtn}
          onPress={() =>
            navigation.reset({
              index: 0,
              routes: [{ name: "Main" }],
            })
          }
        >
          <Text style={s.doneBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    inner: {
      flex: 1,
      padding: Spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    checkCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: C.success,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.lg,
    },
    checkIcon: { fontSize: 48, color: "#fff" },
    title: {
      fontSize: FontSize.xxl,
      fontWeight: "800",
      color: C.white,
      marginBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: C.muted,
      marginBottom: Spacing.xl,
      textAlign: "center",
    },
    card: {
      width: "100%",
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: Spacing.sm,
    },
    rowLabel: { fontSize: FontSize.sm, color: C.muted },
    rowValue: { fontSize: FontSize.sm, color: C.white, fontWeight: "600" },
    totalRow: {
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: C.border,
    },
    totalLabel: { fontSize: FontSize.md, color: C.white, fontWeight: "700" },
    totalValue: { fontSize: FontSize.xl, color: C.brand, fontWeight: "800" },
    refCard: {
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      backgroundColor: C.brand + "10",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "30",
      padding: Spacing.md,
      marginBottom: Spacing.xl,
    },
    refLabel: { fontSize: FontSize.sm, color: C.muted },
    refValue: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    doneBtn: {
      width: "100%",
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      alignItems: "center",
    },
    doneBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
  });
