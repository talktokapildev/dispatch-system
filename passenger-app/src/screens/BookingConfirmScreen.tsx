import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStripe } from "@stripe/stripe-react-native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { toMiles } from "../lib/mapUtils";

const OPERATOR_BANK = {
  name: "Kapil Dev",
  sortCode: "11-02-16",
  accountNo: "11762260",
};

type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD";

const PAYMENT_OPTIONS = [
  {
    id: "CASH" as PaymentMethod,
    icon: "💵",
    label: "Cash",
    sublabel: "Pay your driver directly",
    free: true,
  },
  {
    id: "BANK_TRANSFER" as PaymentMethod,
    icon: "🏦",
    label: "Bank Transfer",
    sublabel: "Faster Payments — arrives instantly",
    free: true,
  },
  {
    id: "CARD" as PaymentMethod,
    icon: "💳",
    label: "Card / Apple Pay / Google Pay",
    sublabel: "Secure payment via Stripe",
    free: false,
  },
];

export default function BookingConfirmScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { pickup, dropoff, estimate } = route.params;

  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>("CASH");
  const [loading, setLoading] = useState(false);

  // Calculate Stripe fee if card selected (1.5% + 20p)
  const baseFare = estimate?.estimatedFare ?? 0;
  const stripeFee =
    selectedPayment === "CARD"
      ? Math.round((baseFare * 0.015 + 0.2) * 100) / 100
      : 0;
  const totalFare = baseFare + stripeFee;

  const confirmBooking = async () => {
    setLoading(true);
    try {
      if (selectedPayment === "CARD") {
        await handleCardPayment();
      } else {
        await handleFreePayment();
      }
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // ── Card flow: payment FIRST, then booking ─────────────────────────────
  const handleCardPayment = async () => {
    // 1. Create a PaymentIntent without a booking yet
    const { data: piData } = await api.post("/passengers/payment-intent", {
      estimatedFare: baseFare,
      currency: "gbp",
    });
    const { clientSecret, paymentIntentId } = piData.data;

    // 2. Initialise Stripe payment sheet
    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: "OrangeRide",
      style: "alwaysDark",
      googlePay: {
        merchantCountryCode: "GB",
        testEnv: true,
        currencyCode: "gbp",
      },
      applePay: {
        merchantCountryCode: "GB",
      },
      defaultBillingDetails: {
        address: { country: "GB" },
      },
    });

    if (initError) {
      throw new Error(initError.message);
    }

    // 3. Present sheet — passenger pays HERE
    const { error: presentError } = await presentPaymentSheet();

    if (presentError) {
      if (presentError.code === "Canceled") {
        // Passenger dismissed — cancel the payment intent silently
        api
          .delete(`/passengers/payment-intent/${paymentIntentId}`)
          .catch(() => {});
        return; // Stay on confirm screen
      }
      throw new Error(presentError.message);
    }

    // 4. Payment confirmed — NOW create the booking
    setLoading(true);
    const { data: bookingData } = await api.post("/passengers/bookings", {
      pickupAddress: pickup.address,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      dropoffAddress: dropoff.address,
      dropoffLatitude: dropoff.latitude,
      dropoffLongitude: dropoff.longitude,
      passengerCount: 1,
      paymentMethod: "CARD",
      stripePaymentIntentId: paymentIntentId,
    });

    // 5. Navigate to tracking — dispatch fires automatically on booking creation
    navigation.reset({
      index: 0,
      routes: [
        {
          name: "Tracking",
          params: { bookingId: bookingData.data.id, booking: bookingData.data },
        },
      ],
    });
  };

  // ── Cash / bank transfer flow: create booking directly ─────────────────
  const handleFreePayment = async () => {
    const { data } = await api.post("/passengers/bookings", {
      pickupAddress: pickup.address,
      pickupLatitude: pickup.latitude,
      pickupLongitude: pickup.longitude,
      dropoffAddress: dropoff.address,
      dropoffLatitude: dropoff.latitude,
      dropoffLongitude: dropoff.longitude,
      passengerCount: 1,
      paymentMethod: selectedPayment,
    });

    navigation.reset({
      index: 0,
      routes: [
        {
          name: "Tracking",
          params: { bookingId: data.data.id, booking: data.data },
        },
      ],
    });
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={s.backBtn}
          >
            <Text style={s.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={s.title}>Confirm Ride</Text>
        </View>

        {/* Route summary */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Your Trip</Text>
          <View style={s.routeRow}>
            <View style={s.routeDots}>
              <View style={[s.dot, { backgroundColor: Colors.success }]} />
              <View style={s.routeLine} />
              <View style={[s.dot, { backgroundColor: Colors.danger }]} />
            </View>
            <View style={s.routeAddresses}>
              <View style={s.addressBlock}>
                <Text style={s.addressLabel}>PICKUP</Text>
                <Text style={s.addressText}>{pickup.address}</Text>
              </View>
              <View style={s.addressBlock}>
                <Text style={s.addressLabel}>DROPOFF</Text>
                <Text style={s.addressText}>{dropoff.address}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Fare */}
        {estimate && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Fare</Text>
            <View style={s.fareRow}>
              <Text style={s.fareLabel}>Distance</Text>
              <Text style={s.fareValue}>
                {toMiles(estimate.distanceKm)} miles
              </Text>
            </View>
            <View style={s.fareRow}>
              <Text style={s.fareLabel}>Duration</Text>
              <Text style={s.fareValue}>~{estimate.durationMins} minutes</Text>
            </View>
            <View style={s.fareRow}>
              <Text style={s.fareLabel}>Estimated fare</Text>
              <Text style={s.fareValue}>£{baseFare.toFixed(2)}</Text>
            </View>
            {stripeFee > 0 && (
              <View style={s.fareRow}>
                <Text style={s.fareLabel}>Card processing fee</Text>
                <Text style={[s.fareValue, { color: Colors.muted }]}>
                  £{stripeFee.toFixed(2)}
                </Text>
              </View>
            )}
            <View style={[s.fareRow, s.fareTotalRow]}>
              <Text style={s.fareTotalLabel}>Total</Text>
              <Text style={s.fareTotalValue}>£{totalFare.toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* Payment method selector */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Payment Method</Text>
          {PAYMENT_OPTIONS.map((option) => {
            const isSelected = selectedPayment === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={[
                  s.paymentOption,
                  isSelected && {
                    borderColor: Colors.brand,
                    backgroundColor: Colors.brand + "10",
                  },
                ]}
                onPress={() => setSelectedPayment(option.id)}
              >
                <View style={s.paymentLeft}>
                  <Text style={s.paymentIcon}>{option.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        s.paymentLabel,
                        isSelected && { color: Colors.brand },
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={s.paymentSublabel}>{option.sublabel}</Text>
                  </View>
                </View>
                <View style={s.paymentRight}>
                  {option.free ? (
                    <Text style={s.freeTag}>Free</Text>
                  ) : (
                    <Text style={s.feeTag}>+£{stripeFee.toFixed(2)} fee</Text>
                  )}
                  <View
                    style={[
                      s.radio,
                      isSelected && {
                        borderColor: Colors.brand,
                        backgroundColor: Colors.brand,
                      },
                    ]}
                  >
                    {isSelected && <View style={s.radioDot} />}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bank transfer preview */}
        {selectedPayment === "BANK_TRANSFER" && (
          <View
            style={[
              s.card,
              {
                backgroundColor: Colors.info + "08",
                borderColor: Colors.info + "30",
              },
            ]}
          >
            <Text style={[s.cardTitle, { color: Colors.info }]}>
              🏦 Bank Transfer Details
            </Text>
            <Text style={s.bankText}>
              You'll see full bank details after your trip completes.
            </Text>
            <Text style={s.bankText}>
              Use your booking reference as the payment reference.
            </Text>
          </View>
        )}

        {/* Card info note */}
        {selectedPayment === "CARD" && (
          <View
            style={[
              s.card,
              {
                backgroundColor: Colors.brand + "08",
                borderColor: Colors.brand + "30",
              },
            ]}
          >
            <Text
              style={{
                color: Colors.brand,
                fontSize: FontSize.sm,
                lineHeight: 20,
              }}
            >
              💳 Your card will be pre-authorised now. Payment is only captured
              when your trip completes.
            </Text>
          </View>
        )}

        {/* TfL note */}
        <View
          style={[
            s.card,
            {
              backgroundColor: Colors.info + "08",
              borderColor: Colors.info + "30",
            },
          ]}
        >
          <Text
            style={{
              color: Colors.info,
              fontSize: FontSize.sm,
              lineHeight: 20,
            }}
          >
            🏛 Your ride is operated under a TfL Private Hire Operator licence.
          </Text>
        </View>
      </ScrollView>

      {/* Confirm button */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.confirmBtn, loading && s.confirmBtnDisabled]}
          onPress={confirmBooking}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={s.confirmBtnText}>
              {selectedPayment === "CARD"
                ? `Pay £${totalFare.toFixed(2)} & Book`
                : "Confirm Booking"}
            </Text>
          )}
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      padding: Spacing.lg,
      paddingBottom: Spacing.sm,
      gap: Spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
      justifyContent: "center",
    },
    backIcon: { color: C.text, fontSize: FontSize.lg },
    title: { fontSize: FontSize.xl, fontWeight: "700", color: C.white },
    card: {
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
    },
    cardTitle: {
      fontSize: FontSize.xs,
      color: C.muted,
      fontWeight: "600",
      marginBottom: Spacing.md,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    routeRow: { flexDirection: "row", gap: Spacing.md },
    routeDots: { alignItems: "center", paddingTop: 4 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    routeLine: {
      width: 2,
      height: 48,
      backgroundColor: C.border,
      marginVertical: 4,
    },
    routeAddresses: { flex: 1, gap: Spacing.md },
    addressBlock: {},
    addressLabel: {
      fontSize: FontSize.xs,
      color: C.muted,
      fontWeight: "700",
      marginBottom: 2,
    },
    addressText: { fontSize: FontSize.sm, color: C.white, lineHeight: 20 },
    fareRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    fareLabel: { fontSize: FontSize.sm, color: C.muted },
    fareValue: { fontSize: FontSize.sm, color: C.white, fontWeight: "500" },
    fareTotalRow: { borderBottomWidth: 0, marginTop: Spacing.sm },
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
    paymentOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    paymentLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
      flex: 1,
    },
    paymentIcon: { fontSize: 24 },
    paymentLabel: { fontSize: FontSize.sm, color: C.white, fontWeight: "600" },
    paymentSublabel: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    paymentRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    freeTag: { fontSize: FontSize.xs, color: C.success, fontWeight: "700" },
    feeTag: { fontSize: FontSize.xs, color: C.muted, fontWeight: "600" },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: C.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#000" },
    bankText: {
      fontSize: FontSize.sm,
      color: C.muted,
      lineHeight: 20,
      marginBottom: Spacing.sm,
    },
    footer: {
      padding: Spacing.lg,
      paddingBottom: Spacing.xl,
      borderTopWidth: 1,
      borderTopColor: C.border,
    },
    confirmBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      alignItems: "center",
    },
    confirmBtnDisabled: { opacity: 0.6 },
    confirmBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
  });
