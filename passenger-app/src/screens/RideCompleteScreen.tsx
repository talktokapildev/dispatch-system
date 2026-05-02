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
  const { booking } = route.params;
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [rated, setRated] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const fare = booking?.actualFare ?? booking?.estimatedFare ?? 0;
  const paymentMethod = booking?.paymentMethod ?? "CASH";
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

        {/* Report an Issue — TfL Condition 7 */}
        {!complaintSubmitted ? (
          <TouchableOpacity
            style={s.reportBtn}
            onPress={() => setComplaintVisible(true)}
          >
            <Text style={s.reportBtnText}>⚠ Report an Issue</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.reportedCard}>
            <Text style={s.reportedText}>✓ Complaint submitted</Text>
          </View>
        )}

        {/* Lost Property — TfL Condition 9 */}
        {!lostSubmitted ? (
          <TouchableOpacity
            style={s.reportBtn}
            onPress={() => setLostPropertyVisible(true)}
          >
            <Text style={s.reportBtnText}>🎒 Report Lost Property</Text>
          </TouchableOpacity>
        ) : (
          <View style={s.reportedCard}>
            <Text style={s.reportedText}>✓ Lost property reported</Text>
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
    ratedCard: { marginBottom: Spacing.md },
    ratedText: { fontSize: FontSize.md, color: C.success, fontWeight: "600" },
    reportBtn: {
      width: "100%",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    reportBtnText: { fontSize: FontSize.sm, color: C.muted, fontWeight: "500" },
    reportedCard: {
      width: "100%",
      padding: Spacing.md,
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    reportedText: { fontSize: FontSize.sm, color: C.success },
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
  });
