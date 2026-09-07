import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Clipboard,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useOperatorSettings } from "../lib/operatorSettings";

import { useStripe } from "@stripe/stripe-react-native";
import { getSocket } from "../lib/socket";

const OPERATOR_BANK = {
  name: "Kapil Dev",
  sortCode: "11-02-16",
  accountNo: "11762260",
};

const COMPLAINT_CATEGORIES = [
  "Driver behaviour",
  "Vehicle condition",
  "Late arrival",
  "Wrong route taken",
  "Overcharged",
  "Safety concern",
  "Lost property",
  "Other",
];

export default function RideCompleteScreen({ route, navigation }: any) {
  const { Colors } = useTheme();
  const { settings } = useOperatorSettings();
  const { booking } = route.params;
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [rated, setRated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);

  // Complaint state
  const [complaintVisible, setComplaintVisible] = useState(false);
  const [complaintCategory, setComplaintCategory] = useState("");
  const [complaintDescription, setComplaintDescription] = useState("");
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);
  const [complaintSubmitted, setComplaintSubmitted] = useState(false);

  // Lost property state
  const [lostPropertyVisible, setLostPropertyVisible] = useState(false);
  const [lostDescription, setLostDescription] = useState("");
  const [lostSubmitting, setLostSubmitting] = useState(false);
  const [lostSubmitted, setLostSubmitted] = useState(false);

  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [cardPaymentState, setCardPaymentState] = useState<
    "idle" | "loading" | "success"
  >("idle");

  // Tip state
  const [tipVisible, setTipVisible] = useState(false);
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [tipCustom, setTipCustom] = useState("");
  const [tipState, setTipState] = useState<"idle" | "loading" | "success">(
    "idle"
  );

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

  useEffect(() => {
    const s = getSocket();
    if (!s) return;

    const handleCardRequested = async (data: any) => {
      if (data.bookingId !== booking.id) return;
      // Driver triggered card payment — auto-show Stripe sheet on passenger's phone
      setCardPaymentState("loading");
      await processCardPayment(data.clientSecret);
    };

    s.on("booking:card_payment_requested", handleCardRequested);
    return () => {
      s.off("booking:card_payment_requested", handleCardRequested);
    };
  }, [booking.id]);

  // Auto-show tip modal if actual fare > estimated fare by >10%
  useEffect(() => {
    const CARD_METHODS = ["CARD", "APPLE_PAY", "GOOGLE_PAY"];
    const estimated = booking?.estimatedFare ?? 0;
    const actual = booking?.actualFare ?? estimated;
    if (
      CARD_METHODS.includes(booking?.paymentMethod) &&
      actual > estimated * 1.1 &&
      actual - estimated >= 1.0
    ) {
      // Small delay so the arrival animation completes first
      const t = setTimeout(() => setTipVisible(true), 1500);
      return () => clearTimeout(t);
    }
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

  const submitFeedback = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSubmitting(true);
    try {
      await api.post(`/passengers/bookings/${booking.id}/rate`, {
        rating,
        comment: feedbackText.trim(),
      });
      setFeedbackSent(true);
    } catch {
      Alert.alert("Error", "Could not send your feedback. Please try again.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const copyReference = () => {
    Clipboard.setString(booking?.reference ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitComplaint = async () => {
    if (!complaintCategory) {
      Alert.alert(
        "Please select a category",
        "Choose what your complaint is about."
      );
      return;
    }
    if (!complaintDescription.trim()) {
      Alert.alert(
        "Please describe the issue",
        "Add a brief description of what happened."
      );
      return;
    }
    setComplaintSubmitting(true);
    try {
      await api.post(`/passengers/bookings/${booking.id}/complaint`, {
        category: complaintCategory,
        description: complaintDescription.trim(),
      });
      setComplaintSubmitted(true);
      setComplaintVisible(false);
      Alert.alert(
        "Complaint Received",
        `Your complaint has been submitted. Reference: ${booking?.reference}\n\nWe will respond within 48 hours.`
      );
    } catch {
      Alert.alert(
        "Error",
        "Failed to submit complaint. Please email admin@orangeride.co.uk with your booking reference."
      );
    } finally {
      setComplaintSubmitting(false);
    }
  };

  const submitLostProperty = async () => {
    if (!lostDescription.trim()) {
      Alert.alert(
        "Please describe the item",
        "Tell us what you left in the vehicle."
      );
      return;
    }
    setLostSubmitting(true);
    try {
      await api.post(`/passengers/bookings/${booking.id}/lost-property`, {
        description: lostDescription.trim(),
      });
      setLostSubmitted(true);
      setLostPropertyVisible(false);
      Alert.alert(
        "Lost Property Reported",
        `Your report has been submitted. Reference: ${booking?.reference}\n\nWe will contact you if the item is found.`
      );
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ??
          "Failed to submit. Please email admin@orangeride.co.uk with your booking reference."
      );
    } finally {
      setLostSubmitting(false);
    }
  };

  // Shared card payment processor — used by both passenger-triggered and
  // driver-triggered flows
  const processCardPayment = async (clientSecret: string) => {
    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: "OrangeRide",
      style: "automatic", // respects passenger app light/dark theme
      googlePay: {
        merchantCountryCode: "GB",
        testEnv: false,
        currencyCode: "gbp",
      },
      applePay: { merchantCountryCode: "GB" },
      defaultBillingDetails: { address: { country: "GB" } },
    });

    if (initError) {
      Alert.alert("Payment setup failed", initError.message);
      setCardPaymentState("idle");
      return;
    }

    const { error: presentError } = await presentPaymentSheet();

    if (presentError) {
      if (presentError.code !== "Canceled") {
        Alert.alert("Payment failed", presentError.message);
      }
      setCardPaymentState("idle");
      return;
    }

    // Payment confirmed by Stripe — notify backend to update booking + alert driver
    try {
      await api.patch(`/passengers/bookings/${booking.id}/mark-card-paid`);
    } catch {
      // Payment went through — just update locally if backend call fails
    }
    setCardPaymentState("success");
  };

  // Passenger taps "Pay by card instead"
  const handlePayByCard = async () => {
    setCardPaymentState("loading");
    try {
      const { data } = await api.post(
        `/passengers/bookings/${booking.id}/pay-by-card`
      );
      await processCardPayment(data.data.clientSecret);
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ?? "Could not set up card payment"
      );
      setCardPaymentState("idle");
    }
  };

  const handleTip = async (amount: number) => {
    setTipAmount(amount);
    setTipState("loading");
    try {
      const { data } = await api.post(
        `/passengers/bookings/${booking.id}/tip`,
        { amount }
      );
      const { clientSecret } = data.data;

      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: "OrangeRide",
        style: "automatic",
        applePay: { merchantCountryCode: "GB" },
        googlePay: {
          merchantCountryCode: "GB",
          testEnv: false,
          currencyCode: "gbp",
        },
        defaultBillingDetails: { address: { country: "GB" } },
      });

      if (initError) {
        Alert.alert("Error", initError.message);
        setTipState("idle");
        return;
      }

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== "Canceled")
          Alert.alert("Payment failed", presentError.message);
        setTipState("idle");
        return;
      }

      // Confirm tip on backend
      await api.post(`/passengers/bookings/${booking.id}/tip/confirm`, {
        amount,
      });
      setTipState("success");
      setTipVisible(false);
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error ?? "Something went wrong");
      setTipState("idle");
    }
  };

  const fare = booking?.actualFare ?? booking?.estimatedFare ?? 0;
  const paymentMethod = booking?.paymentMethod ?? "CASH";
  // Wallet-adjusted cash amount — only populated by the backend for CASH
  // bookings with a real passenger, excluding corporate/care home. When
  // present, this (not the full fare) is what the passenger actually owes
  // in cash — the driver's screen shows this same number.
  const hasWalletSuggestion =
    paymentMethod === "CASH" &&
    booking?.suggestedCashCollection !== undefined &&
    booking?.suggestedCashCollection !== null;
  const cashDue = hasWalletSuggestion ? booking.suggestedCashCollection : fare;
  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        contentContainerStyle={s.inner}
        showsVerticalScrollIndicator={false}
      >
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

        {/* Reference */}
        <TouchableOpacity style={s.refCard} onPress={copyReference}>
          <Text style={s.refLabel}>Reference</Text>
          <Text style={s.refValue}>{booking?.reference}</Text>
          <Text style={s.copyHint}>{copied ? "✓ Copied" : "tap to copy"}</Text>
        </TouchableOpacity>

        {/* Payment instructions */}
        {paymentMethod === "CASH" && cardPaymentState !== "success" && (
          <>
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
                  {hasWalletSuggestion && cashDue === 0
                    ? "Fully covered by your wallet — no cash needed."
                    : `Please pay £${cashDue.toFixed(2)} to your driver.`}
                </Text>
                {hasWalletSuggestion && cashDue < fare && cashDue > 0 && (
                  <Text style={[s.paymentText, { marginTop: 4 }]}>
                    £{(fare - cashDue).toFixed(2)} covered by your wallet.
                  </Text>
                )}
              </View>
            </View>

            {cardPaymentState === "idle" && (
              <TouchableOpacity style={s.cardPayBtn} onPress={handlePayByCard}>
                <Text style={s.cardPayBtnText}>💳 Pay by card instead</Text>
              </TouchableOpacity>
            )}

            {cardPaymentState === "loading" && (
              <View style={s.cardPayBtn}>
                <ActivityIndicator color={Colors.brand} size="small" />
                <Text style={[s.cardPayBtnText, { marginLeft: 8 }]}>
                  Setting up payment...
                </Text>
              </View>
            )}
          </>
        )}

        {paymentMethod === "CASH" && cardPaymentState === "success" && (
          <View
            style={[
              s.paymentCard,
              {
                borderColor: Colors.success + "40",
                backgroundColor: Colors.success + "08",
              },
            ]}
          >
            <Text style={s.paymentIcon}>✅</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.paymentTitle, { color: Colors.success }]}>
                Paid by Card
              </Text>
              <Text style={s.paymentText}>
                £{fare.toFixed(2)} has been charged to your card. Thank you!
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

        {/* ── Rate, report, contact — collapsed by default so payment stays the focus ── */}
        <TouchableOpacity
          style={s.moreToggle}
          onPress={() => setMoreExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={s.moreToggleText}>
            {moreExpanded ? "▾" : "▸"} Rate your trip, report an issue, or
            contact us
          </Text>
        </TouchableOpacity>

        {moreExpanded && (
          <View style={s.moreSection}>
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
              </View>
            ) : (
              rating > 0 && (
                <View style={s.ratedCard}>
                  <Text style={s.ratedText}>
                    Thanks for your {rating}★ rating!
                  </Text>
                  {!feedbackSent ? (
                    <View style={s.feedbackBox}>
                      <TextInput
                        style={s.feedbackInput}
                        placeholder="Tell us more (optional)"
                        placeholderTextColor={Colors.muted}
                        value={feedbackText}
                        onChangeText={setFeedbackText}
                        multiline
                        maxLength={500}
                        editable={!feedbackSubmitting}
                      />
                      {feedbackText.trim().length > 0 && (
                        <TouchableOpacity
                          style={[
                            s.feedbackSendBtn,
                            feedbackSubmitting && { opacity: 0.6 },
                          ]}
                          onPress={submitFeedback}
                          disabled={feedbackSubmitting}
                        >
                          {feedbackSubmitting ? (
                            <ActivityIndicator color="#000" size="small" />
                          ) : (
                            <Text style={s.feedbackSendBtnText}>Send</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <Text style={s.feedbackSentText}>
                      ✓ Thanks for the feedback!
                    </Text>
                  )}
                </View>
              )
            )}

            {/* Report an Issue (TfL Condition 7) + Lost Property (TfL Condition 9) */}
            <View style={s.reportRow}>
              {!complaintSubmitted ? (
                <TouchableOpacity
                  style={[s.reportBtn, s.reportBtnHalf]}
                  onPress={() => setComplaintVisible(true)}
                >
                  <Text style={s.reportBtnText}>⚠ Report Issue</Text>
                </TouchableOpacity>
              ) : (
                <View style={[s.reportedCard, s.reportBtnHalf]}>
                  <Text style={s.reportedText}>✓ Reported</Text>
                </View>
              )}

              {!lostSubmitted ? (
                <TouchableOpacity
                  style={[s.reportBtn, s.reportBtnHalf]}
                  onPress={() => setLostPropertyVisible(true)}
                >
                  <Text style={s.reportBtnText}>🎒 Lost Property</Text>
                </TouchableOpacity>
              ) : (
                <View style={[s.reportedCard, s.reportBtnHalf]}>
                  <Text style={s.reportedText}>✓ Reported</Text>
                </View>
              )}
            </View>

            {/* TfL Condition 14 — operating centre contact */}
            <TouchableOpacity
              style={s.contactBtn}
              onPress={() =>
                Linking.openURL(
                  `tel:${settings.contactPhone.replace(/\s/g, "")}`
                )
              }
            >
              <Text style={s.contactBtnText}>
                📞 Contact OrangeRide {settings.contactPhone}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={s.doneBtn}
          onPress={() =>
            navigation.reset({ index: 0, routes: [{ name: "Main" }] })
          }
        >
          <Text style={s.doneBtnText}>Back to Home</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Complaint Modal ── */}
      <Modal
        visible={complaintVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setComplaintVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView
            style={[s.modalContainer, { backgroundColor: Colors.bg }]}
          >
            <View style={[s.modalHeader, { borderBottomColor: Colors.border }]}>
              <Text style={[s.modalTitle, { color: Colors.text }]}>
                Report an Issue
              </Text>
              <TouchableOpacity onPress={() => setComplaintVisible(false)}>
                <Text style={[s.modalClose, { color: Colors.muted }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={s.modalBody}
              showsVerticalScrollIndicator={false}
            >
              <View
                style={[
                  s.modalRefCard,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                ]}
              >
                <Text style={[s.modalRefLabel, { color: Colors.muted }]}>
                  Booking Reference
                </Text>
                <Text style={[s.modalRefValue, { color: Colors.brand }]}>
                  {booking?.reference}
                </Text>
              </View>
              <Text style={[s.sectionLabel, { color: Colors.text }]}>
                What is your complaint about? *
              </Text>
              <View style={s.categoryGrid}>
                {COMPLAINT_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      s.categoryChip,
                      {
                        borderColor:
                          complaintCategory === cat
                            ? Colors.brand
                            : Colors.border,
                        backgroundColor:
                          complaintCategory === cat
                            ? Colors.brand + "15"
                            : Colors.card,
                      },
                    ]}
                    onPress={() => setComplaintCategory(cat)}
                  >
                    <Text
                      style={[
                        s.categoryChipText,
                        {
                          color:
                            complaintCategory === cat
                              ? Colors.brand
                              : Colors.muted,
                        },
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[s.sectionLabel, { color: Colors.text }]}>
                Describe what happened *
              </Text>
              <TextInput
                style={[
                  s.descInput,
                  {
                    backgroundColor: Colors.card,
                    borderColor: Colors.border,
                    color: Colors.text,
                  },
                ]}
                placeholder="Please provide details of your complaint..."
                placeholderTextColor={Colors.muted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                value={complaintDescription}
                onChangeText={setComplaintDescription}
                maxLength={500}
              />
              <Text style={[s.charCount, { color: Colors.muted }]}>
                {complaintDescription.length}/500
              </Text>
              <Text style={[s.disclaimer, { color: Colors.muted }]}>
                Your complaint will be reviewed by OrangeRide. We aim to respond
                within 48 hours. You may also contact us directly at
                admin@orangeride.co.uk.
              </Text>
              <TouchableOpacity
                style={[
                  s.submitBtn,
                  { backgroundColor: Colors.brand },
                  complaintSubmitting && { opacity: 0.7 },
                ]}
                onPress={submitComplaint}
                disabled={complaintSubmitting}
              >
                {complaintSubmitting ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={s.submitBtnText}>Submit Complaint</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Lost Property Modal ── */}
      <Modal
        visible={lostPropertyVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLostPropertyVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <SafeAreaView
            style={[s.modalContainer, { backgroundColor: Colors.bg }]}
          >
            <View style={[s.modalHeader, { borderBottomColor: Colors.border }]}>
              <Text style={[s.modalTitle, { color: Colors.text }]}>
                Report Lost Property
              </Text>
              <TouchableOpacity onPress={() => setLostPropertyVisible(false)}>
                <Text style={[s.modalClose, { color: Colors.muted }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={s.modalBody}
              showsVerticalScrollIndicator={false}
            >
              <View
                style={[
                  s.modalRefCard,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                ]}
              >
                <Text style={[s.modalRefLabel, { color: Colors.muted }]}>
                  Booking Reference
                </Text>
                <Text style={[s.modalRefValue, { color: Colors.brand }]}>
                  {booking?.reference}
                </Text>
              </View>
              <Text style={[s.sectionLabel, { color: Colors.text }]}>
                Describe the item(s) left behind *
              </Text>
              <TextInput
                style={[
                  s.descInput,
                  {
                    backgroundColor: Colors.card,
                    borderColor: Colors.border,
                    color: Colors.text,
                  },
                ]}
                placeholder="e.g. Black iPhone 14, left on rear seat..."
                placeholderTextColor={Colors.muted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                value={lostDescription}
                onChangeText={setLostDescription}
                maxLength={500}
                autoFocus
              />
              <Text style={[s.charCount, { color: Colors.muted }]}>
                {lostDescription.length}/500
              </Text>
              <Text style={[s.disclaimer, { color: Colors.muted }]}>
                We will contact your driver and notify you if the item is found.
                You can also contact us at admin@orangeride.co.uk.
              </Text>
              <TouchableOpacity
                style={[
                  s.submitBtn,
                  { backgroundColor: Colors.brand },
                  lostSubmitting && { opacity: 0.7 },
                ]}
                onPress={submitLostProperty}
                disabled={lostSubmitting}
              >
                {lostSubmitting ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={s.submitBtnText}>Submit Report</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Tip Modal ── */}
      <Modal
        visible={tipVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTipVisible(false)}
      >
        <SafeAreaView
          style={[s.modalContainer, { backgroundColor: Colors.bg }]}
        >
          <View style={[s.modalHeader, { borderBottomColor: Colors.border }]}>
            <Text style={[s.modalTitle, { color: Colors.text }]}>
              Thank your driver 🙏
            </Text>
            <TouchableOpacity onPress={() => setTipVisible(false)}>
              <Text style={[s.modalClose, { color: Colors.muted }]}>
                No thanks
              </Text>
            </TouchableOpacity>
          </View>
          <View style={s.modalBody}>
            <Text
              style={{
                color: Colors.muted,
                fontSize: FontSize.sm,
                marginBottom: Spacing.lg,
                textAlign: "center",
              }}
            >
              Your trip took a little longer than estimated.{"\n"}
              Would you like to add a tip for your driver?
            </Text>

            {/* Quick tip amounts */}
            <View
              style={{
                flexDirection: "row",
                gap: Spacing.sm,
                marginBottom: Spacing.md,
              }}
            >
              {[1, 2, 5].map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={{
                    flex: 1,
                    borderRadius: Radius.md,
                    borderWidth: 1,
                    borderColor:
                      tipAmount === amt ? Colors.brand : Colors.border,
                    backgroundColor:
                      tipAmount === amt ? Colors.brand + "15" : Colors.card,
                    padding: Spacing.md,
                    alignItems: "center",
                  }}
                  onPress={() => {
                    setTipAmount(amt);
                    setTipCustom("");
                  }}
                >
                  <Text
                    style={{
                      color: tipAmount === amt ? Colors.brand : Colors.white,
                      fontWeight: "700",
                      fontSize: FontSize.md,
                    }}
                  >
                    £{amt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom amount */}
            <TextInput
              style={[
                s.descInput,
                {
                  backgroundColor: Colors.card,
                  borderColor: Colors.border,
                  color: Colors.text,
                  minHeight: 0,
                  height: 48,
                },
              ]}
              placeholder="Custom amount (£)"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
              value={tipCustom}
              onChangeText={(v) => {
                setTipCustom(v);
                setTipAmount(parseFloat(v) || null);
              }}
            />

            <TouchableOpacity
              style={[
                s.submitBtn,
                { backgroundColor: Colors.brand, marginTop: Spacing.md },
                (!tipAmount || tipState === "loading") && { opacity: 0.5 },
              ]}
              onPress={() => tipAmount && handleTip(tipAmount)}
              disabled={!tipAmount || tipState === "loading"}
            >
              {tipState === "loading" ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={s.submitBtnText}>
                  Send £{tipAmount?.toFixed(2) ?? "0.00"} tip
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    inner: {
      padding: Spacing.lg,
      alignItems: "center",
      paddingBottom: Spacing.xl,
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
    ratedCard: { marginBottom: Spacing.md, width: "100%" },
    ratedText: { fontSize: FontSize.md, color: C.success, fontWeight: "600" },
    feedbackBox: { width: "100%", marginTop: Spacing.sm },
    feedbackInput: {
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.card,
      borderRadius: Radius.md,
      padding: Spacing.md,
      fontSize: FontSize.sm,
      color: C.white,
      minHeight: 70,
      textAlignVertical: "top",
      marginBottom: Spacing.sm,
    },
    feedbackSendBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      paddingVertical: Spacing.sm,
      alignItems: "center",
    },
    feedbackSendBtnText: {
      color: "#000",
      fontWeight: "700",
      fontSize: FontSize.sm,
    },
    feedbackSentText: {
      fontSize: FontSize.xs,
      color: C.success,
      marginTop: Spacing.xs,
    },
    reportBtn: {
      width: "100%",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    reportRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      width: "100%",
      marginBottom: Spacing.sm,
    },
    reportBtnHalf: {
      flex: 1,
      marginBottom: 0,
    },
    reportBtnText: { fontSize: FontSize.sm, color: C.muted, fontWeight: "500" },
    reportedCard: {
      width: "100%",
      padding: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    reportedText: { fontSize: FontSize.sm, color: C.success },
    contactBtn: {
      width: "100%",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "30",
      backgroundColor: C.brand + "08",
      padding: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    contactBtnText: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "600",
    },
    doneBtn: {
      width: "100%",
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    doneBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    modalContainer: { flex: 1 },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: Spacing.lg,
      borderBottomWidth: 1,
    },
    modalTitle: { fontSize: FontSize.lg, fontWeight: "700" },
    modalClose: { fontSize: FontSize.md },
    modalBody: { flex: 1, padding: Spacing.lg },
    modalRefCard: {
      borderRadius: Radius.md,
      borderWidth: 1,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    modalRefLabel: { fontSize: FontSize.xs },
    modalRefValue: {
      fontSize: FontSize.sm,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    sectionLabel: {
      fontSize: FontSize.sm,
      fontWeight: "600",
      marginBottom: Spacing.sm,
      marginTop: Spacing.sm,
    },
    categoryGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.xs,
      marginBottom: Spacing.md,
    },
    categoryChip: {
      borderWidth: 1,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    categoryChipText: { fontSize: FontSize.xs, fontWeight: "500" },
    descInput: {
      borderWidth: 1,
      borderRadius: Radius.md,
      padding: Spacing.md,
      fontSize: FontSize.sm,
      minHeight: 120,
      marginBottom: Spacing.xs,
    },
    charCount: {
      fontSize: FontSize.xs,
      textAlign: "right",
      marginBottom: Spacing.md,
    },
    disclaimer: {
      fontSize: FontSize.xs,
      lineHeight: 18,
      marginBottom: Spacing.lg,
      textAlign: "center",
    },
    submitBtn: {
      borderRadius: Radius.md,
      padding: Spacing.lg,
      alignItems: "center",
      marginBottom: Spacing.xl,
    },
    submitBtnText: { color: "#000", fontWeight: "800", fontSize: FontSize.md },
    cardPayBtn: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "40",
      backgroundColor: C.brand + "08",
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    cardPayBtnText: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "600",
    },
    moreToggle: {
      width: "100%",
      paddingVertical: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    moreToggleText: {
      fontSize: FontSize.sm,
      color: C.muted,
      fontWeight: "600",
    },
    moreSection: {
      width: "100%",
    },
  });
