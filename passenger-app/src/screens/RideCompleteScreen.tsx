import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  ActivityIndicator,
  Clipboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

const OPERATOR_BANK = {
  name: "Kapil Dev",
  sortCode: "11-02-16",
  accountNo: "11762260",
};

export default function RideCompleteScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { booking } = route.params;
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [rated, setRated] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const submitRating = async (stars: number) => {
    setRating(stars);
    setSubmitting(true);
    try {
      await api.post(`/passengers/bookings/${booking.id}/rate`, {
        rating: stars,
      });
      setRated(true);
    } catch {
      setRated(true);
    } finally {
      setSubmitting(false);
    }
  };

  const copyReference = () => {
    Clipboard.setString(booking?.reference ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fare = booking?.actualFare ?? booking?.estimatedFare ?? 0;
  const paymentMethod = booking?.paymentMethod ?? "CASH";
  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        {/* Animated check */}
        <Animated.View
          style={[
            s.checkCircle,
            { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
          ]}
        >
          <Text style={s.checkIcon}>✓</Text>
        </Animated.View>

        <Text style={s.title}>You've arrived!</Text>
        <Text style={s.subtitle}>Thank you for riding with OrangeRide.</Text>

        {/* Fare card */}
        <View style={s.card}>
          <View style={s.fareRow}>
            <Text style={s.fareLabel}>Trip Fare</Text>
            <Text style={s.fareValue}>£{fare.toFixed(2)}</Text>
          </View>
          <View style={[s.fareRow, s.fareTotal]}>
            <Text style={s.fareTotalLabel}>Total Charged</Text>
            <Text style={s.fareTotalValue}>£{fare.toFixed(2)}</Text>
          </View>
        </View>

        {/* Reference — tappable to copy */}
        <TouchableOpacity style={s.refCard} onPress={copyReference}>
          <Text style={s.refLabel}>Reference</Text>
          <Text style={s.refValue}>{booking?.reference}</Text>
          <Text style={s.copyHint}>{copied ? "✓ Copied" : "tap to copy"}</Text>
        </TouchableOpacity>

        {/* Payment instructions based on method */}
        {paymentMethod === "CASH" && (
          <View
            style={[
              s.paymentCard,
              {
                borderColor: Colors.success + "40",
                backgroundColor: Colors.success + "08",
              },
            ]}
          >
            <Text style={s.paymentIcon}>💵</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.paymentTitle, { color: Colors.success }]}>
                Pay by Cash
              </Text>
              <Text style={s.paymentText}>
                Please pay £{fare.toFixed(2)} to your driver.
              </Text>
            </View>
          </View>
        )}

        {paymentMethod === "BANK_TRANSFER" && (
          <View
            style={[
              s.paymentCard,
              {
                borderColor: Colors.info + "40",
                backgroundColor: Colors.info + "08",
              },
            ]}
          >
            <Text style={s.paymentIcon}>🏦</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.paymentTitle, { color: Colors.info }]}>
                Bank Transfer
              </Text>
              <Text style={s.paymentText}>
                Please transfer £{fare.toFixed(2)} to:
              </Text>
              <Text style={s.bankDetail}>{OPERATOR_BANK.name}</Text>
              <Text style={s.bankDetail}>
                Sort code: {OPERATOR_BANK.sortCode}
              </Text>
              <Text style={s.bankDetail}>
                Account: {OPERATOR_BANK.accountNo}
              </Text>
              <Text
                style={[s.bankDetail, { color: Colors.brand, marginTop: 4 }]}
              >
                Reference: {booking?.reference}
              </Text>
            </View>
          </View>
        )}

        {paymentMethod === "CARD" && (
          <View
            style={[
              s.paymentCard,
              {
                borderColor: Colors.brand + "40",
                backgroundColor: Colors.brand + "08",
              },
            ]}
          >
            <Text style={s.paymentIcon}>💳</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.paymentTitle, { color: Colors.brand }]}>
                Card Payment
              </Text>
              <Text style={s.paymentText}>
                £{fare.toFixed(2)} will be charged to your card.
              </Text>
            </View>
          </View>
        )}

        {/* Star rating */}
        {!rated ? (
          <View style={s.ratingSection}>
            <Text style={s.ratingTitle}>Rate your driver</Text>
            <View style={s.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => submitRating(star)}
                  disabled={submitting}
                  style={s.starBtn}
                >
                  <Text style={[s.star, rating >= star && s.starFilled]}>
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {submitting && (
              <ActivityIndicator
                color={Colors.brand}
                size="small"
                style={{ marginTop: 8 }}
              />
            )}
            <TouchableOpacity onPress={() => setRated(true)} style={s.skipBtn}>
              <Text style={s.skipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : (
          rating > 0 && (
            <View style={s.ratedCard}>
              <Text style={s.ratedText}>Thanks for your {rating}★ rating!</Text>
            </View>
          )
        )}

        <TouchableOpacity
          style={s.doneBtn}
          onPress={() =>
            navigation.reset({ index: 0, routes: [{ name: "Main" }] })
          }
        >
          <Text style={s.doneBtnText}>Back to Home</Text>
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
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: C.success,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.md,
    },
    checkIcon: { fontSize: 40, color: "#fff" },
    title: {
      fontSize: FontSize.xxl,
      fontWeight: "800",
      color: C.white,
      marginBottom: Spacing.xs,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: C.muted,
      marginBottom: Spacing.lg,
      textAlign: "center",
    },
    card: {
      width: "100%",
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    fareRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: Spacing.sm,
    },
    fareLabel: { fontSize: FontSize.sm, color: C.muted },
    fareValue: { fontSize: FontSize.sm, color: C.white, fontWeight: "600" },
    fareTotal: {
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: C.border,
      marginBottom: 0,
    },
    fareTotalLabel: {
      fontSize: FontSize.md,
      color: C.white,
      fontWeight: "700",
    },
    fareTotalValue: {
      fontSize: FontSize.xl,
      color: C.brand,
      fontWeight: "800",
    },
    refCard: {
      width: "100%",
      backgroundColor: C.brand + "10",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "30",
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    refLabel: { fontSize: FontSize.xs, color: C.muted },
    refValue: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "700",
      fontFamily: "monospace",
      flex: 1,
      textAlign: "center",
    },
    copyHint: { fontSize: FontSize.xs, color: C.muted },
    // Payment card
    paymentCard: {
      width: "100%",
      flexDirection: "row",
      alignItems: "flex-start",
      gap: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: 1,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    paymentIcon: { fontSize: 24, marginTop: 2 },
    paymentTitle: { fontSize: FontSize.sm, fontWeight: "700", marginBottom: 4 },
    paymentText: { fontSize: FontSize.xs, color: C.muted, lineHeight: 18 },
    bankDetail: {
      fontSize: FontSize.xs,
      color: C.text,
      lineHeight: 20,
      fontFamily: "monospace",
    },
    // Rating
    ratingSection: {
      alignItems: "center",
      marginBottom: Spacing.md,
      width: "100%",
    },
    ratingTitle: {
      fontSize: FontSize.md,
      color: C.white,
      fontWeight: "600",
      marginBottom: Spacing.sm,
    },
    stars: { flexDirection: "row", gap: Spacing.sm },
    starBtn: { padding: 4 },
    star: { fontSize: 36, color: C.border },
    starFilled: { color: "#f59e0b" },
    skipBtn: { marginTop: Spacing.sm },
    skipText: { fontSize: FontSize.sm, color: C.muted },
    ratedCard: { marginBottom: Spacing.md },
    ratedText: { fontSize: FontSize.md, color: C.success, fontWeight: "600" },
    doneBtn: {
      width: "100%",
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      alignItems: "center",
    },
    doneBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
  });
