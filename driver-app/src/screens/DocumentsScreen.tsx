// driver-app/src/screens/DocumentsScreen.tsx
//
// The driver's documents, as the server sees them (GET /driver/dispatch-eligibility):
//   - Your documents: PCO badge, driving licence front + back, DBS
//   - Vehicle (current car): PHV vehicle licence, insurance, MOT, V5C
// Each row: valid until … / expires in N days / renewal waiting for review / rejected (reason) /
// expired / missing. Upload = new version for review (DocumentUploadSheet).
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { DocItem, useDocumentStatus } from "../hooks/useDocumentStatus";
import { DOC_ICONS, formatExpiry } from "../lib/documents";
import { DocumentUploadSheet } from "../components/DocumentUploadSheet";

export default function DocumentsScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const { eligibility, loading, refresh } = useDocumentStatus();
  const [refreshing, setRefreshing] = useState(false);
  const [uploadItem, setUploadItem] = useState<DocItem | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const items = eligibility?.items ?? [];
  const plate = eligibility?.vehicle?.licensePlate ?? null;
  const driverItems = items.filter((i) => i.owner === "driver");
  const vehicleItems = items.filter((i) => i.owner === "vehicle");

  /** Status chip + detail line for a row. */
  const describe = (i: DocItem): { chip: string; color: string; detail: string; action: string } => {
    const until = i.expiryDate ? formatExpiry(i.expiryDate) : "";
    switch (i.state) {
      case "valid": {
        if (i.pendingReview)
          return {
            chip: "Renewal in review",
            color: Colors.info,
            detail: until ? `Current copy valid until ${until}` : "Current copy is valid",
            action: "Replace",
          };
        if (i.daysLeft !== null && i.daysLeft <= 30)
          return {
            chip: i.daysLeft === 0 ? "Expires today" : `Expires in ${i.daysLeft}d`,
            color: "#f97316",
            detail: `Valid until ${until} — upload the renewal`,
            action: "Upload renewal",
          };
        return { chip: "Valid", color: Colors.success, detail: until ? `Valid until ${until}` : "On file", action: "Update" };
      }
      case "pending":
        return { chip: "In review", color: Colors.warning, detail: "We'll let you know once it's checked", action: "Replace" };
      case "rejected":
        return {
          chip: "Rejected",
          color: Colors.danger,
          detail: i.rejectionReason ?? "Please upload it again",
          action: "Upload again",
        };
      case "expired":
        return {
          chip: "Expired",
          color: Colors.danger,
          detail: i.pendingReview ? `Expired ${until} — new copy in review` : `Expired ${until}`,
          action: i.pendingReview ? "Replace" : "Upload new",
        };
      case "expiry_needed":
        return { chip: "Being checked", color: Colors.warning, detail: "OrangeRide is checking the expiry date", action: "Update" };
      default:
        return { chip: "Missing", color: Colors.muted, detail: "Not uploaded yet", action: "Upload" };
    }
  };

  const s = styles(Colors);

  const Row = ({ item }: { item: DocItem }) => {
    const d = describe(item);
    // Rejected reason shows when a renewal was rejected but the current copy is still valid
    const rejectedNote = item.state === "valid" && item.rejectionReason ? `New copy rejected: ${item.rejectionReason}` : null;
    return (
      <View style={s.docCard}>
        <View style={s.docLeft}>
          <Text style={s.docIcon}>{DOC_ICONS[item.type] ?? "📄"}</Text>
          <View style={s.docInfo}>
            <Text style={s.docLabel}>{item.label}</Text>
            <Text style={[s.docDetail, (item.state === "rejected" || item.state === "expired") && { color: Colors.danger }]}>
              {d.detail}
            </Text>
            {rejectedNote && <Text style={[s.docDetail, { color: Colors.danger }]}>{rejectedNote}</Text>}
          </View>
        </View>
        <View style={s.docRight}>
          <View style={[s.statusBadge, { backgroundColor: d.color + "20", borderColor: d.color + "40" }]}>
            <Text style={[s.statusText, { color: d.color }]}>{d.chip}</Text>
          </View>
          <TouchableOpacity style={s.uploadBtn} onPress={() => setUploadItem(item)}>
            <Text style={s.uploadBtnText}>↑ {d.action}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.title}>Documents</Text>
          <Text style={s.subtitle}>You get jobs while all of these are valid</Text>
        </View>
      </View>

      {loading && !eligibility ? (
        <ActivityIndicator color={Colors.brand} style={{ marginTop: Spacing.xxl }} />
      ) : (
        <ScrollView
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.brand} />}
        >
          {eligibility && (
            <View
              style={[
                s.summary,
                eligibility.eligible
                  ? { borderColor: Colors.success + "55", backgroundColor: Colors.success + "15" }
                  : { borderColor: Colors.danger + "55", backgroundColor: Colors.danger + "15" },
              ]}
            >
              <Text style={[s.summaryText, { color: eligibility.eligible ? Colors.success : Colors.danger }]}>
                {eligibility.eligible ? "✓ All in order — you can take jobs" : eligibility.message || "Some documents need attention"}
              </Text>
            </View>
          )}

          <Text style={s.section}>Your documents</Text>
          {driverItems.map((i) => (
            <Row key={i.type} item={i} />
          ))}

          <Text style={s.section}>{plate ? `Vehicle · ${plate}` : "Vehicle"}</Text>
          {eligibility?.noVehicle ? (
            <View style={s.docCard}>
              <Text style={s.docDetail}>No vehicle is assigned to you. Please contact OrangeRide.</Text>
            </View>
          ) : (
            vehicleItems.map((i) => <Row key={i.type} item={i} />)
          )}

          <Text style={s.footer}>
            Upload renewals before they expire — your current copy stays valid while the new one is checked.
          </Text>
        </ScrollView>
      )}

      <DocumentUploadSheet
        item={uploadItem}
        vehiclePlate={plate}
        onClose={() => setUploadItem(null)}
        onUploaded={refresh}
      />
    </SafeAreaView>
  );
}

const styles = (Colors: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.bg },
    header: {
      padding: Spacing.lg,
      paddingBottom: Spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: Colors.card,
      borderWidth: 1,
      borderColor: Colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    backIcon: { color: Colors.text, fontSize: FontSize.lg },
    headerText: { flex: 1 },
    title: { fontSize: FontSize.xxl, fontWeight: "700", color: Colors.white },
    subtitle: { fontSize: FontSize.sm, color: Colors.muted, marginTop: 2 },
    list: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
    summary: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md },
    summaryText: { fontSize: FontSize.sm, fontWeight: "600" },
    section: {
      fontSize: FontSize.xs,
      color: Colors.muted,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      marginTop: Spacing.md,
    },
    docCard: {
      backgroundColor: Colors.card,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: Spacing.md,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    docLeft: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, flex: 1 },
    docIcon: { fontSize: 24 },
    docInfo: { flex: 1 },
    docLabel: { fontSize: FontSize.sm, color: Colors.white, fontWeight: "600" },
    docDetail: { fontSize: FontSize.xs, color: Colors.muted, marginTop: 2 },
    docRight: { alignItems: "flex-end", gap: Spacing.xs, marginLeft: Spacing.sm },
    statusBadge: { borderRadius: Radius.full, borderWidth: 1, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
    statusText: { fontSize: FontSize.xs, fontWeight: "700" },
    uploadBtn: { paddingVertical: 4, paddingHorizontal: Spacing.xs },
    uploadBtnText: { fontSize: FontSize.xs, color: Colors.brand, fontWeight: "600" },
    footer: { fontSize: FontSize.xs, color: Colors.muted, textAlign: "center", marginTop: Spacing.md },
  });
