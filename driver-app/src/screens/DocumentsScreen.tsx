import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { format, differenceInDays } from "date-fns";
import { useTheme } from "../lib/ThemeContext";

const DOC_TYPES = [
  { type: "PCO_LICENSE", label: "PCO Licence", icon: "🪪" },
  { type: "DRIVING_LICENSE", label: "Driving Licence", icon: "🚗" },
  { type: "VEHICLE_INSURANCE", label: "Insurance", icon: "🛡️" },
  { type: "MOT_CERTIFICATE", label: "MOT Certificate", icon: "🔧" },
  { type: "V5C_LOGBOOK", label: "V5C Logbook", icon: "📋" },
  { type: "DBS_CHECK", label: "DBS Check", icon: "✅" },
];

type DocStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "EXPIRED"
  | "EXPIRING_SOON";

export default function DocumentsScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);

  const STATUS_CONFIG: Record<DocStatus, { color: string; label: string }> = {
    APPROVED: { color: Colors.success, label: "Approved" },
    PENDING: { color: Colors.warning, label: "Under Review" },
    REJECTED: { color: Colors.danger, label: "Rejected" },
    EXPIRED: { color: Colors.danger, label: "Expired" },
    EXPIRING_SOON: { color: "#f97316", label: "Expiring Soon" },
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const { data } = await api.get("/drivers/documents");
      setDocuments(data.data ?? []);
    } catch {
      Alert.alert("Error", "Could not load documents");
    } finally {
      setLoading(false);
    }
  };

  const getDocStatus = (doc: any): DocStatus => {
    if (!doc) return "PENDING";
    if (doc.status === "REJECTED") return "REJECTED";
    if (doc.status === "PENDING") return "PENDING";
    if (doc.expiryDate) {
      const daysLeft = differenceInDays(new Date(doc.expiryDate), new Date());
      if (daysLeft < 0) return "EXPIRED";
      if (daysLeft <= 30) return "EXPIRING_SOON";
    }
    return "APPROVED";
  };

  const uploadDocument = async (docType: string) => {
    // Request media library permission first
    const { status: mediaStatus } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (mediaStatus !== "granted") {
      Alert.alert(
        "Permission needed",
        "Please allow photo library access in Settings"
      );
      return;
    }

    // On iPad, camera may not be available — check before showing option
    const cameraAvailable = Platform.OS !== "web";

    if (cameraAvailable) {
      Alert.alert("Upload Document", "Choose source", [
        {
          text: "Camera",
          onPress: async () => {
            // Request camera permission explicitly
            const { status: camStatus } =
              await ImagePicker.requestCameraPermissionsAsync();
            if (camStatus !== "granted") {
              Alert.alert(
                "Permission needed",
                "Please allow camera access in Settings"
              );
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              quality: 0.8,
            });
            if (!result.canceled) await doUpload(docType, result.assets[0]);
          },
        },
        {
          text: "Photo Library",
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              quality: 0.8,
            });
            if (!result.canceled) await doUpload(docType, result.assets[0]);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.8,
      });
      if (!result.canceled) await doUpload(docType, result.assets[0]);
    }
  };

  const doUpload = async (docType: string, asset: any) => {
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: `${docType.toLowerCase()}.jpg`,
        type: "image/jpeg",
      } as any);
      formData.append("type", docType);
      await api.post("/drivers/documents", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      Alert.alert("Uploaded", "Your document has been submitted for review.");
      fetchDocuments();
    } catch (err: any) {
      Alert.alert(
        "Upload failed",
        err.response?.data?.error ?? "Please try again"
      );
    } finally {
      setUploading(null);
    }
  };

  const s = StyleSheet.create({
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
    list: { padding: Spacing.lg, gap: Spacing.sm },
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
    docLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      flex: 1,
    },
    docIcon: { fontSize: 24 },
    docInfo: { flex: 1 },
    docLabel: { fontSize: FontSize.sm, color: Colors.white, fontWeight: "600" },
    docExpiry: { fontSize: FontSize.xs, color: Colors.muted, marginTop: 2 },
    docRejection: { fontSize: FontSize.xs, color: Colors.danger, marginTop: 2 },
    docRight: { alignItems: "flex-end", gap: Spacing.xs },
    statusBadge: {
      borderRadius: Radius.full,
      borderWidth: 1,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    statusText: { fontSize: FontSize.xs, fontWeight: "700" },
    uploadBtn: { paddingVertical: 4, paddingHorizontal: Spacing.sm },
    uploadBtnText: {
      fontSize: FontSize.xs,
      color: Colors.brand,
      fontWeight: "600",
    },
  });

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.title}>Documents</Text>
          <Text style={s.subtitle}>TfL compliance documents</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator
          color={Colors.brand}
          style={{ marginTop: Spacing.xxl }}
        />
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {DOC_TYPES.map(({ type, label, icon }) => {
            const doc = documents.find((d) => d.type === type);
            const docStatus = getDocStatus(doc);
            const statusCfg = STATUS_CONFIG[docStatus];
            return (
              <View key={type} style={s.docCard}>
                <View style={s.docLeft}>
                  <Text style={s.docIcon}>{icon}</Text>
                  <View style={s.docInfo}>
                    <Text style={s.docLabel}>{label}</Text>
                    {doc?.expiryDate && (
                      <Text style={s.docExpiry}>
                        Expires{" "}
                        {format(new Date(doc.expiryDate), "dd MMM yyyy")}
                      </Text>
                    )}
                    {doc?.status === "REJECTED" && doc?.rejectionReason && (
                      <Text style={s.docRejection}>{doc.rejectionReason}</Text>
                    )}
                  </View>
                </View>
                <View style={s.docRight}>
                  <View
                    style={[
                      s.statusBadge,
                      {
                        backgroundColor: statusCfg.color + "20",
                        borderColor: statusCfg.color + "40",
                      },
                    ]}
                  >
                    <Text style={[s.statusText, { color: statusCfg.color }]}>
                      {statusCfg.label}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={s.uploadBtn}
                    onPress={() => uploadDocument(type)}
                    disabled={uploading === type}
                  >
                    {uploading === type ? (
                      <ActivityIndicator size="small" color={Colors.brand} />
                    ) : (
                      <Text style={s.uploadBtnText}>
                        {doc ? "↑ Update" : "↑ Upload"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
