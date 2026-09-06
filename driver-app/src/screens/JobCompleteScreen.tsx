// ─── JobCompleteScreen.tsx ─────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  ActivityIndicator,
  Alert,
  Keyboard,
  TouchableWithoutFeedback,
  InputAccessoryView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

export default function JobCompleteScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { booking } = route.params;
  const CASH_INPUT_ACCESSORY_ID = "cashCollectedInput";
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Card payment state — only relevant for CASH bookings
  const [cardPaymentState, setCardPaymentState] = useState<
    "idle" | "waiting" | "confirmed"
  >("idle");

  const isCash = (booking?.paymentMethod ?? "CASH") === "CASH";

  // ── Wallet cash-settlement state ──────────────────────────────────────────
  // suggestedCashCollection is only populated by the backend for CASH
  // bookings with a real passenger, excluding corporate/care home — so its
  // presence (not just isCash) is what gates this whole section.
  const hasWalletSuggestion =
    isCash &&
    booking?.suggestedCashCollection !== undefined &&
    booking?.suggestedCashCollection !== null;
  const suggestedCash: number = hasWalletSuggestion
    ? booking.suggestedCashCollection
    : 0;

  const [cashInput, setCashInput] = useState(
    hasWalletSuggestion ? suggestedCash.toFixed(2) : ""
  );
  const [cashSettleState, setCashSettleState] = useState<
    "idle" | "submitting" | "confirmed" | "error"
  >("idle");
  const [settlementResult, setSettlementResult] = useState<{
    expectedCollection: number;
    variance: number;
  } | null>(null);

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

  // Listen for passenger completing card payment
  useEffect(() => {
    if (!isCash) return;

    const s = getSocket();
    if (!s) return;

    const handleConfirmed = (data: any) => {
      if (data.bookingId !== booking?.id) return;
      setCardPaymentState("confirmed");
    };

    s.on("booking:card_payment_confirmed", handleConfirmed);
    return () => {
      s.off("booking:card_payment_confirmed", handleConfirmed);
    };
  }, [booking?.id, isCash]);

  const handleRequestCardPayment = async () => {
    setCardPaymentState("waiting");
    try {
      await api.post(`/drivers/bookings/${booking.id}/request-card-payment`);
      // Success means socket was sent to passenger — now wait for confirmation
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Could not request card payment"
      );
      setCardPaymentState("idle");
    }
  };

  // ── Submit the actual settlement to the backend ───────────────────────────
  const submitCashCollection = async (amount: number) => {
    setCashSettleState("submitting");
    try {
      const res = await api.patch(
        `/drivers/jobs/${booking.id}/cash-collected`,
        {
          amountCollected: amount,
        }
      );
      setSettlementResult(res.data?.data ?? null);
      setCashSettleState("confirmed");
    } catch (err: any) {
      setCashSettleState("idle");
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Could not confirm cash collection"
      );
    }
  };

  // ── Validate + soft-warn on mismatch before submitting ────────────────────
  const handleConfirmCash = () => {
    const amount = parseFloat(cashInput);
    if (isNaN(amount) || amount < 0) {
      Alert.alert("Invalid amount", "Please enter a valid amount collected.");
      return;
    }

    // Soft warning — not a hard block. Threshold is whichever is larger:
    // 20% of the suggested amount, or £5 flat.
    const threshold = Math.max(suggestedCash * 0.2, 5);
    const diff = Math.abs(amount - suggestedCash);

    if (diff > threshold) {
      Alert.alert(
        "Amount doesn't match",
        `You entered £${amount.toFixed(2)}, but £${suggestedCash.toFixed(
          2
        )} was suggested. Continue with £${amount.toFixed(2)}?`,
        [
          { text: "Go back", style: "cancel" },
          {
            text: "Confirm anyway",
            onPress: () => submitCashCollection(amount),
          },
        ]
      );
      return;
    }

    submitCashCollection(amount);
  };

  const fare = booking?.actualFare ?? booking?.estimatedFare ?? 0;
  const commissionRate = booking?.commissionRate ?? 0.15;
  const platformFee = booking?.platformFee ?? fare * commissionRate;
  const driverEarning = booking?.driverEarning ?? fare - platformFee;
  const s = styles(Colors);

  // Cash section only makes sense while the driver hasn't routed to card
  const showCashSection = hasWalletSuggestion && cardPaymentState === "idle";

  return (
    <>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
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
              {isCash
                ? "Collect cash from passenger or request card payment."
                : "Your payment is being processed."}
            </Text>

            {/* Earnings breakdown */}
            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.rowLabel}>Trip Fare</Text>
                <Text style={s.rowValue}>£{fare.toFixed(2)}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowLabel}>
                  Platform Fee ({Math.round(commissionRate * 100)}%)
                </Text>
                <Text style={[s.rowValue, { color: Colors.muted }]}>
                  -£{platformFee.toFixed(2)}
                </Text>
              </View>
              <View style={[s.row, s.totalRow]}>
                <Text style={s.totalLabel}>Your Earnings</Text>
                <Text style={s.totalValue}>£{driverEarning.toFixed(2)}</Text>
              </View>
            </View>

            {/* Reference */}
            <View style={s.refCard}>
              <Text style={s.refLabel}>Reference</Text>
              <Text style={s.refValue}>{booking?.reference}</Text>
            </View>

            {/* ── Wallet cash-collection section — CASH bookings with a real
             passenger, non-corporate/care-home only ──────────────────────── */}
            {showCashSection && cashSettleState !== "confirmed" && (
              <View style={s.cashCard}>
                {suggestedCash === 0 ? (
                  <>
                    <Text style={s.cashNoneTitle}>
                      No cash needed — fully covered by wallet
                    </Text>
                    <TouchableOpacity
                      style={[
                        s.cashConfirmBtn,
                        cashSettleState === "submitting" &&
                          s.cashConfirmBtnDisabled,
                      ]}
                      disabled={cashSettleState === "submitting"}
                      onPress={() => submitCashCollection(0)}
                    >
                      {cashSettleState === "submitting" ? (
                        <ActivityIndicator color="#000" size="small" />
                      ) : (
                        <Text style={s.cashConfirmBtnText}>
                          Confirm — No Cash Collected
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={s.cashLabel}>
                      Amount to collect: £{suggestedCash.toFixed(2)}
                    </Text>
                    <TextInput
                      style={s.cashInput}
                      value={cashInput}
                      onChangeText={setCashInput}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={Colors.muted}
                      editable={cashSettleState !== "submitting"}
                      inputAccessoryViewID={
                        Platform.OS === "ios"
                          ? CASH_INPUT_ACCESSORY_ID
                          : undefined
                      }
                    />
                    <TouchableOpacity
                      style={[
                        s.cashConfirmBtn,
                        cashSettleState === "submitting" &&
                          s.cashConfirmBtnDisabled,
                      ]}
                      disabled={cashSettleState === "submitting"}
                      onPress={handleConfirmCash}
                    >
                      {cashSettleState === "submitting" ? (
                        <ActivityIndicator color="#000" size="small" />
                      ) : (
                        <Text style={s.cashConfirmBtnText}>
                          Confirm Cash Collected
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {showCashSection && cashSettleState === "confirmed" && (
              <View style={s.cashConfirmedCard}>
                <Text style={s.cashConfirmedText}>
                  ✅ Cash collection confirmed
                  {settlementResult && settlementResult.variance !== 0
                    ? settlementResult.variance > 0
                      ? ` (£${settlementResult.variance.toFixed(2)} over)`
                      : ` (£${Math.abs(settlementResult.variance).toFixed(
                          2
                        )} under)`
                    : ""}
                </Text>
              </View>
            )}

            {/* Card payment section — CASH bookings only */}
            {isCash && (
              <>
                {cardPaymentState === "idle" && (
                  <TouchableOpacity
                    style={s.cardPayBtn}
                    onPress={handleRequestCardPayment}
                  >
                    <Text style={s.cardPayBtnText}>
                      💳 Passenger paying by card
                    </Text>
                  </TouchableOpacity>
                )}

                {cardPaymentState === "waiting" && (
                  <View style={s.cardPayWaiting}>
                    <ActivityIndicator color={Colors.brand} size="small" />
                    <Text style={s.cardPayWaitingText}>
                      Waiting for passenger to pay...
                    </Text>
                  </View>
                )}

                {cardPaymentState === "confirmed" && (
                  <View style={s.cardPayConfirmed}>
                    <Text style={s.cardPayConfirmedText}>
                      ✅ Card payment confirmed
                    </Text>
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              style={s.doneBtn}
              onPress={() =>
                // popToTop() cleanly unwinds [Main, JobComplete] → [Main]
                navigation.reset({ index: 0, routes: [{ name: "Main" }] })
              }
            >
              <Text style={s.doneBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </TouchableWithoutFeedback>
      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID={CASH_INPUT_ACCESSORY_ID}>
          <View style={s.keyboardAccessory}>
            <TouchableOpacity
              onPress={Keyboard.dismiss}
              style={s.keyboardDoneBtn}
            >
              <Text style={s.keyboardDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </>
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
      marginBottom: Spacing.lg,
    },
    refLabel: { fontSize: FontSize.sm, color: C.muted },
    refValue: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    cashCard: {
      width: "100%",
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
    },
    cashLabel: {
      fontSize: FontSize.md,
      color: C.white,
      fontWeight: "700",
      marginBottom: Spacing.sm,
      textAlign: "center",
    },
    cashNoneTitle: {
      fontSize: FontSize.md,
      color: C.success,
      fontWeight: "700",
      marginBottom: Spacing.md,
      textAlign: "center",
    },
    cashInput: {
      width: "100%",
      backgroundColor: C.bg,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      fontSize: FontSize.xl,
      fontWeight: "700",
      color: C.white,
      textAlign: "center",
      marginBottom: Spacing.md,
    },
    cashConfirmBtn: {
      width: "100%",
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    cashConfirmBtnDisabled: { opacity: 0.6 },
    cashConfirmBtnText: {
      color: "#000",
      fontWeight: "800",
      fontSize: FontSize.sm,
    },
    cashConfirmedCard: {
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.success + "40",
      backgroundColor: C.success + "08",
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    cashConfirmedText: {
      fontSize: FontSize.sm,
      color: C.success,
      fontWeight: "700",
    },
    cardPayBtn: {
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "40",
      backgroundColor: C.brand + "08",
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    cardPayBtnText: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "600",
    },
    cardPayWaiting: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "40",
      backgroundColor: C.brand + "08",
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    cardPayWaitingText: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "600",
    },
    cardPayConfirmed: {
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.success + "40",
      backgroundColor: C.success + "08",
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    cardPayConfirmedText: {
      fontSize: FontSize.sm,
      color: C.success,
      fontWeight: "700",
    },
    doneBtn: {
      width: "100%",
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      alignItems: "center",
    },
    doneBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    keyboardAccessory: {
      backgroundColor: C.card,
      borderTopWidth: 1,
      borderTopColor: C.border,
      padding: Spacing.sm,
      alignItems: "flex-end",
    },
    keyboardDoneBtn: {
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.md,
    },
    keyboardDoneBtnText: {
      color: C.brand,
      fontWeight: "700",
      fontSize: FontSize.md,
    },
  });
