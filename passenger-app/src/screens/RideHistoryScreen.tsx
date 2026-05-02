import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "#22c55e",
  CANCELLED: "#ef4444",
  IN_PROGRESS: "#f59e0b",
  PENDING: "#64748b",
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

function parseComplaint(feedback: string | null) {
  if (!feedback || !feedback.startsWith("[COMPLAINT]")) return null;
  const lines = feedback.replace("[COMPLAINT] ", "").split("\n");
  const category = lines[0]?.replace("Category: ", "") ?? "";
  const description = lines.slice(1).join("\n").trim();
  return { category, description };
}

function parseResolution(operatorNotes: string | null): string | null {
  if (!operatorNotes) return null;
  const match = operatorNotes.match(/\[ACK\][^\n]*Note: ([^\n]+)/);
  return match ? match[1].trim() : null;
}

export default function RideHistoryScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Complaint modal state
  const [complaintBooking, setComplaintBooking] = useState<any>(null);
  const [complaintCategory, setComplaintCategory] = useState("");
  const [complaintDescription, setComplaintDescription] = useState("");
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);

  // Lost property modal state
  const [lostBooking, setLostBooking] = useState<any>(null);
  const [lostDescription, setLostDescription] = useState("");
  const [lostSubmitting, setLostSubmitting] = useState(false);

  useEffect(() => {
    fetchBookings(1);
  }, []);

  const fetchBookings = async (p: number) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const { data } = await api.get("/passengers/bookings", {
        params: { page: p, limit: 20 },
      });
      const items = data.data?.items ?? data.data ?? [];
      setBookings(p === 1 ? items : (prev) => [...prev, ...items]);
      setHasMore(items.length === 20);
      setPage(p);
    } catch {
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
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
      Alert.alert("Please describe the issue", "Add a brief description.");
      return;
    }
    setComplaintSubmitting(true);
    try {
      await api.post(`/passengers/bookings/${complaintBooking.id}/complaint`, {
        category: complaintCategory,
        description: complaintDescription.trim(),
      });
      // Update booking in list to show complaint
      setBookings((prev) =>
        prev.map((b) =>
          b.id === complaintBooking.id
            ? {
                ...b,
                feedback: `[COMPLAINT] Category: ${complaintCategory}\n${complaintDescription.trim()}`,
              }
            : b
        )
      );
      setComplaintBooking(null);
      setComplaintCategory("");
      setComplaintDescription("");
      Alert.alert(
        "Complaint Received",
        `Reference: ${complaintBooking.reference}\n\nWe will respond within 48 hours.`
      );
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ??
          "Failed to submit. Please email admin@orangeride.co.uk."
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
      await api.post(`/passengers/bookings/${lostBooking.id}/lost-property`, {
        description: lostDescription.trim(),
      });
      const ref = lostBooking.reference;
      setLostBooking(null);
      setLostDescription("");
      await fetchBookings(1);
      Alert.alert(
        "Lost Property Reported",
        `Reference: ${ref}\n\nWe will contact you if the item is found.`
      );
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.error ??
          "Failed to submit. Please email admin@orangeride.co.uk."
      );
    } finally {
      setLostSubmitting(false);
    }
  };

  const s = styles(Colors);

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>Ride History</Text>
        </View>
        <ActivityIndicator
          color={Colors.brand}
          style={{ marginTop: Spacing.xxl }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Ride History</Text>
        <Text style={s.subtitle}>{bookings.length} rides</Text>
      </View>

      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        onEndReached={() => {
          if (hasMore && !loadingMore) fetchBookings(page + 1);
        }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              color={Colors.brand}
              style={{ padding: Spacing.lg }}
            />
          ) : null
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🚕</Text>
            <Text style={s.emptyText}>No rides yet</Text>
            <Text style={s.emptySub}>Your trip history will appear here</Text>
          </View>
        }
        renderItem={({ item }) => {
          const statusColor = STATUS_COLORS[item.status] ?? Colors.muted;
          const fare = item.actualFare ?? item.estimatedFare ?? 0;
          const complaint = parseComplaint(item.feedback);
          const resolutionNote = parseResolution(item.operatorNotes);
          const isResolved = !!resolutionNote;
          const isExpanded = expanded === item.id;
          const isCompleted = item.status === "COMPLETED";
          const hasComplaint = !!complaint;
          const lostProperty = item.lostProperties?.[0] ?? null;
          const hasLostProperty = !!lostProperty;
          const lostPropertyStatus = lostProperty?.status ?? null;
          const lostPropertyNotes = lostProperty?.adminNotes ?? null;

          return (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.ref}>{item.reference}</Text>
                <View
                  style={[
                    s.statusBadge,
                    {
                      backgroundColor: statusColor + "20",
                      borderColor: statusColor + "40",
                    },
                  ]}
                >
                  <Text style={[s.statusText, { color: statusColor }]}>
                    {item.status.replace(/_/g, " ")}
                  </Text>
                </View>
              </View>

              <View style={s.route}>
                <View style={s.routeRow}>
                  <View style={[s.dot, { backgroundColor: Colors.success }]} />
                  <Text style={s.routeText} numberOfLines={1}>
                    {item.pickupAddress}
                  </Text>
                </View>
                <View style={s.routeLine} />
                <View style={s.routeRow}>
                  <View style={[s.dot, { backgroundColor: Colors.danger }]} />
                  <Text style={s.routeText} numberOfLines={1}>
                    {item.dropoffAddress}
                  </Text>
                </View>
              </View>

              <View style={s.cardBottom}>
                <Text style={s.date}>
                  {format(new Date(item.createdAt), "dd MMM yyyy · HH:mm")}
                </Text>
                {fare > 0 && <Text style={s.fare}>£{fare.toFixed(2)}</Text>}
              </View>

              {/* Action buttons for completed rides */}
              {isCompleted && (
                <View style={[s.actionRow, { borderTopColor: Colors.border }]}>
                  {!hasComplaint ? (
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => {
                        setComplaintBooking(item);
                        setComplaintCategory("");
                        setComplaintDescription("");
                      }}
                    >
                      <Text style={[s.actionBtnText, { color: Colors.muted }]}>
                        ⚠ Report Issue
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={s.actionBtn}>
                      <Text
                        style={[
                          s.actionBtnText,
                          { color: isResolved ? Colors.success : "#f97316" },
                        ]}
                      >
                        {isResolved
                          ? "✅ Issue resolved"
                          : "⚠ Issue under review"}
                      </Text>
                    </View>
                  )}
                  <View style={s.actionDivider} />
                  {!hasLostProperty ? (
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() => {
                        setLostBooking(item);
                        setLostDescription("");
                      }}
                    >
                      <Text style={[s.actionBtnText, { color: Colors.muted }]}>
                        🎒 Lost Property
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={s.actionBtn}
                      onPress={() =>
                        setExpanded(isExpanded ? null : item.id + "_lost")
                      }
                    >
                      <Text
                        style={[
                          s.actionBtnText,
                          {
                            color:
                              lostPropertyStatus === "RETURNED"
                                ? Colors.success
                                : lostPropertyStatus === "FOUND"
                                ? Colors.info
                                : Colors.brand,
                          },
                        ]}
                      >
                        🎒{" "}
                        {lostPropertyStatus === "RETURNED"
                          ? "Returned"
                          : lostPropertyStatus === "FOUND"
                          ? "Found!"
                          : "Reported"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Complaint detail — expandable */}
              {complaint && (
                <>
                  <TouchableOpacity
                    style={[
                      s.complaintBanner,
                      { borderTopColor: Colors.border },
                    ]}
                    onPress={() => setExpanded(isExpanded ? null : item.id)}
                  >
                    <Text style={s.complaintIcon}>
                      {isResolved ? "✅" : "⚠"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          s.complaintCategory,
                          { color: isResolved ? Colors.success : "#f97316" },
                        ]}
                      >
                        Complaint: {complaint.category}
                      </Text>
                      <Text style={s.complaintStatus}>
                        {isResolved
                          ? `Resolved — ${resolutionNote}`
                          : "Under review · We aim to respond within 48 hours"}
                      </Text>
                    </View>
                    <Text style={[s.complaintChevron, { color: Colors.muted }]}>
                      {isExpanded ? "▲" : "▼"}
                    </Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View
                      style={[
                        s.complaintDetail,
                        { borderTopColor: Colors.border },
                      ]}
                    >
                      <Text
                        style={[
                          s.complaintDetailLabel,
                          { color: Colors.muted },
                        ]}
                      >
                        Your complaint:
                      </Text>
                      <Text
                        style={[s.complaintDetailText, { color: Colors.text }]}
                      >
                        {complaint.description || "(No description provided)"}
                      </Text>
                      {!isResolved && (
                        <Text
                          style={[
                            s.complaintDetailLabel,
                            { color: Colors.muted, marginTop: Spacing.sm },
                          ]}
                        >
                          Contact us: admin@orangeride.co.uk
                        </Text>
                      )}
                    </View>
                  )}
                </>
              )}

              {/* Lost property detail — expandable */}
              {hasLostProperty && expanded === item.id + "_lost" && (
                <View
                  style={[s.complaintDetail, { borderTopColor: Colors.border }]}
                >
                  <Text
                    style={[s.complaintDetailLabel, { color: Colors.muted }]}
                  >
                    Lost item: {lostProperty.description}
                  </Text>
                  {lostPropertyNotes ? (
                    <Text
                      style={[s.complaintDetailText, { color: Colors.text }]}
                    >
                      Update: {lostPropertyNotes}
                    </Text>
                  ) : (
                    <Text
                      style={[
                        s.complaintDetailLabel,
                        { color: Colors.muted, marginTop: Spacing.xs },
                      ]}
                    >
                      We will contact you if the item is found.
                    </Text>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />

      {/* ── Complaint Modal ── */}
      <Modal
        visible={!!complaintBooking}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setComplaintBooking(null)}
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
              <TouchableOpacity onPress={() => setComplaintBooking(null)}>
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
                  {complaintBooking?.reference}
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
                placeholder="Please provide details..."
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
                We aim to respond within 48 hours. Contact:
                admin@orangeride.co.uk
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
        visible={!!lostBooking}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLostBooking(null)}
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
              <TouchableOpacity onPress={() => setLostBooking(null)}>
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
                  {lostBooking?.reference}
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
                Contact: admin@orangeride.co.uk
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
    header: { padding: Spacing.lg, paddingBottom: Spacing.sm },
    title: { fontSize: FontSize.xxl, fontWeight: "700", color: C.white },
    subtitle: { fontSize: FontSize.sm, color: C.muted, marginTop: 2 },
    list: { padding: Spacing.lg, gap: Spacing.sm },
    card: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
    },
    cardTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    ref: {
      fontSize: FontSize.xs,
      color: C.brand,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    statusBadge: {
      borderRadius: Radius.full,
      borderWidth: 1,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    statusText: { fontSize: FontSize.xs, fontWeight: "700" },
    route: { marginBottom: Spacing.sm },
    routeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    routeText: { fontSize: FontSize.sm, color: C.text, flex: 1 },
    routeLine: {
      width: 2,
      height: 12,
      backgroundColor: C.border,
      marginLeft: 3,
      marginVertical: 2,
    },
    cardBottom: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    date: { fontSize: FontSize.xs, color: C.muted },
    fare: { fontSize: FontSize.md, color: C.brand, fontWeight: "700" },
    // Action row
    actionRow: {
      flexDirection: "row",
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
    },
    actionBtn: { flex: 1, alignItems: "center", paddingVertical: Spacing.xs },
    actionBtnText: { fontSize: FontSize.xs, fontWeight: "600" },
    actionDivider: { width: 1, backgroundColor: C.border, marginVertical: 2 },
    // Complaint
    complaintBanner: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
    },
    complaintIcon: { fontSize: 14, marginTop: 1 },
    complaintCategory: { fontSize: FontSize.xs, fontWeight: "600" },
    complaintStatus: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 1,
      lineHeight: 16,
    },
    complaintChevron: { fontSize: 10, marginTop: 2 },
    complaintDetail: {
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
    },
    complaintDetailLabel: { fontSize: FontSize.xs, marginBottom: 4 },
    complaintDetailText: { fontSize: FontSize.sm, lineHeight: 20 },
    empty: { alignItems: "center", paddingTop: Spacing.xxl },
    emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
    emptyText: { fontSize: FontSize.md, color: C.muted },
    emptySub: { fontSize: FontSize.sm, color: C.muted, marginTop: 4 },
    // Modal
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
