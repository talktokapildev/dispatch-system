import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
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

function parseComplaint(feedback: string | null) {
  if (!feedback || !feedback.startsWith("[COMPLAINT]")) return null;
  const lines = feedback.replace("[COMPLAINT] ", "").split("\n");
  const category = lines[0]?.replace("Category: ", "") ?? "";
  const description = lines.slice(1).join("\n").trim();
  return { category, description };
}

function parseResolution(operatorNotes: string | null): string | null {
  if (!operatorNotes) return null;
  const match = operatorNotes.match(/\[ACK\].*?Note: (.+?)(?:\n|$)/s);
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

          return (
            <TouchableOpacity
              style={s.card}
              activeOpacity={complaint ? 0.8 : 1}
              onPress={() =>
                complaint && setExpanded(isExpanded ? null : item.id)
              }
            >
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

              {/* Complaint indicator */}
              {complaint && (
                <>
                  <View
                    style={[
                      s.complaintBanner,
                      { borderTopColor: Colors.border },
                    ]}
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
                  </View>

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
            </TouchableOpacity>
          );
        }}
      />
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
    empty: { alignItems: "center", paddingTop: Spacing.xxl },
    emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
    emptyText: { fontSize: FontSize.md, color: C.muted },
    emptySub: { fontSize: FontSize.sm, color: C.muted, marginTop: 4 },
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
  });
