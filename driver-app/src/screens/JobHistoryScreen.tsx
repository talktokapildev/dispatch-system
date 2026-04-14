import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { format } from "date-fns";

export default function JobHistoryScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    fetchJobs(1);
  }, []);

  const fetchJobs = async (p: number) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const { data } = await api.get("/drivers/jobs", {
        params: { page: p, limit: 20 },
      });
      const newJobs = data.data?.items ?? data.data?.jobs ?? [];
      setJobs(p === 1 ? newJobs : (prev) => [...prev, ...newJobs]);
      setHasMore(newJobs.length === 20);
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
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={s.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={s.title}>Job History</Text>
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
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Job History</Text>
          <Text style={s.subtitle}>{jobs.length} jobs loaded</Text>
        </View>
      </View>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        onEndReached={() => {
          if (hasMore && !loadingMore) fetchJobs(page + 1);
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
            <Text style={s.emptyIcon}>📋</Text>
            <Text style={s.emptyText}>No jobs yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const net = (item.actualFare ?? item.estimatedFare ?? 0) * 0.85;
          return (
            <View style={s.jobCard}>
              <View style={s.jobTop}>
                <Text style={s.jobRef}>{item.reference}</Text>
                <Text style={s.jobEarning}>£{net.toFixed(2)}</Text>
              </View>
              <View style={s.jobRoute}>
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
              <View style={s.jobBottom}>
                <Text style={s.jobDate}>
                  {format(new Date(item.createdAt), "dd MMM yyyy · HH:mm")}
                </Text>
                <View style={s.typeBadge}>
                  <Text style={s.typeText}>
                    {item.type?.replace(/_/g, " ")}
                  </Text>
                </View>
              </View>
            </View>
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
    title: { fontSize: FontSize.xxl, fontWeight: "700", color: C.white },
    subtitle: { fontSize: FontSize.sm, color: C.muted, marginTop: 2 },
    list: { padding: Spacing.lg, gap: Spacing.sm },
    jobCard: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      padding: Spacing.md,
    },
    jobTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: Spacing.sm,
    },
    jobRef: {
      fontSize: FontSize.xs,
      color: C.brand,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    jobEarning: { fontSize: FontSize.md, color: C.brand, fontWeight: "800" },
    jobRoute: { marginBottom: Spacing.sm },
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
    jobBottom: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    jobDate: { fontSize: FontSize.xs, color: C.muted },
    typeBadge: {
      backgroundColor: C.border,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    typeText: { fontSize: FontSize.xs, color: C.muted },
    empty: { alignItems: "center", paddingTop: Spacing.xxl },
    emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
    emptyText: { fontSize: FontSize.md, color: C.muted },
  });
