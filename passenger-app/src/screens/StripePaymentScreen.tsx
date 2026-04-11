import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStripe } from "@stripe/stripe-react-native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

export default function StripePaymentScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { bookingId, booking, clientSecret, totalFare } = route.params;

  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setupPaymentSheet();
  }, []);

  const setupPaymentSheet = async () => {
    const { error } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: "OrangeRide",
      style: "alwaysDark",
      googlePay: {
        merchantCountryCode: "GB",
        testEnv: true, // set false for production
        currencyCode: "gbp",
      },
      applePay: {
        merchantCountryCode: "GB",
      },
      defaultBillingDetails: {
        address: { country: "GB" },
      },
    });

    if (error) {
      Alert.alert("Payment setup failed", error.message);
      navigation.goBack();
      return;
    }

    setLoading(false);
    setReady(true);
    // Present immediately after init
    presentSheet();
  };

  const presentSheet = async () => {
    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === "Canceled") {
        // User dismissed — go back to confirm screen
        navigation.goBack();
      } else {
        Alert.alert("Payment failed", error.message, [
          { text: "Try again", onPress: presentSheet },
          { text: "Go back", onPress: () => navigation.goBack() },
        ]);
      }
      return;
    }

    // Payment confirmed by Stripe — navigate to tracking
    // Backend will capture the payment when driver completes the trip
    navigation.reset({
      index: 0,
      routes: [
        {
          name: "Tracking",
          params: { bookingId, booking },
        },
      ],
    });
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.inner}>
        <ActivityIndicator color={Colors.brand} size="large" />
        <Text style={s.text}>Setting up payment…</Text>
        <Text style={s.subtext}>£{totalFare?.toFixed(2)}</Text>
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
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.md,
    },
    text: { fontSize: FontSize.md, color: C.text },
    subtext: { fontSize: FontSize.xxl, fontWeight: "800", color: C.brand },
  });
