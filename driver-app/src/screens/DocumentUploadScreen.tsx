// driver-app/src/screens/DocumentUploadScreen.tsx
// Step 2 of the self-onboarding flow.
// Shows 6 document slots. Each image uploads immediately on pick/capture.
// "Submit Application" navigates to ApplicationPendingScreen.

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

type RouteParams = { applicationId: string };

const DOCUMENT_SLOTS = [
  { key: "docPcoBadge", label: "PCO Badge", emoji: "🪪" },
  { key: "docDrivingLicFront", label: "Driving Licence (Front)", emoji: "🪪" },
  { key: "docDrivingLicBack", label: "Driving Licence (Back)", emoji: "🪪" },
  { key: "docPhvLicence", label: "PHV Licence", emoji: "📄" },
  { key: "docInsurance", label: "Insurance Certificate", emoji: "📋" },
  { key: "docMot", label: "MOT Certificate", emoji: "🔧" },
] as const;

type DocKey = (typeof DOCUMENT_SLOTS)[number]["key"];

export default function DocumentUploadScreen() {
  const { Colors, theme } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const { applicationId } = route.params;

  // Track uploaded URLs per document
  const [uploaded, setUploaded] = useState<Record<DocKey, string | null>>({
    docPcoBadge: null,
    docDrivingLicFront: null,
    docDrivingLicBack: null,
    docPhvLicence: null,
    docInsurance: null,
    docMot: null,
  });

  // Track which slots are currently uploading
  const [uploading, setUploading] = useState<Record<DocKey, boolean>>({
    docPcoBadge: false,
    docDrivingLicFront: false,
    docDrivingLicBack: false,
    docPhvLicence: false,
    docInsurance: false,
    docMot: false,
  });

  const uploadedCount = Object.values(uploaded).filter(Boolean).length;

  const pickImage = async (docKey: DocKey, useCamera: boolean) => {
    // Request permissions
    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Camera access is required to take photos of your documents."
        );
        return;
      }
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Photo library access is required to select document photos."
        );
        return;
      }
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          quality: 0.75,
          base64: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.75,
          base64: true,
        });

    if (result.canceled || !result.assets?.[0]?.base64) return;

    const base64 = result.assets[0].base64!;

    // Upload immediately
    setUploading((u) => ({ ...u, [docKey]: true }));
    try {
      const { data } = await api.post(
        `/driver-applications/${applicationId}/documents`,
        { docType: docKey, image: `data:image/jpeg;base64,${base64}` }
      );
      setUploaded((u) => ({ ...u, [docKey]: data.url }));
    } catch (err: any) {
      Alert.alert(
        "Upload failed",
        err.response?.data?.error ??
          "Could not upload document. Please try again."
      );
    } finally {
      setUploading((u) => ({ ...u, [docKey]: false }));
    }
  };

  const showPickerOptions = (docKey: DocKey, label: string) => {
    Alert.alert(label, "How would you like to add this document?", [
      { text: "Take Photo", onPress: () => pickImage(docKey, true) },
      { text: "Choose from Library", onPress: () => pickImage(docKey, false) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleSubmit = () => {
    if (uploadedCount < 6) {
      Alert.alert(
        "Missing documents",
        `You have uploaded ${uploadedCount} of 6 documents. You can submit now and upload the remaining documents later, but your application may be delayed.`,
        [
          { text: "Continue Uploading", style: "cancel" },
          {
            text: "Submit Anyway",
            onPress: () =>
              navigation.replace("ApplicationPending", { applicationId }),
          },
        ]
      );
      return;
    }
    navigation.replace("ApplicationPending", { applicationId });
  };

  const s = styles(Colors);

  return (
    <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Upload Documents</Text>
        <Text style={s.headerSub}>
          {uploadedCount} of {DOCUMENT_SLOTS.length} uploaded
        </Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressBg}>
        <View
          style={[
            s.progressFill,
            { width: `${(uploadedCount / DOCUMENT_SLOTS.length) * 100}%` },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.info}>
          Tap each document to take a photo or choose from your library. Images
          upload immediately — no need to wait before moving on.
        </Text>

        {DOCUMENT_SLOTS.map((slot) => {
          const isUploading = uploading[slot.key];
          const url = uploaded[slot.key];
          const isDone = !!url;

          return (
            <TouchableOpacity
              key={slot.key}
              style={[s.slot, isDone && s.slotDone]}
              onPress={() => showPickerOptions(slot.key, slot.label)}
              disabled={isUploading}
              activeOpacity={0.7}
            >
              {isUploading ? (
                <View style={s.slotLoading}>
                  <ActivityIndicator color={Colors.brand} />
                  <Text style={[s.slotLabel, { marginLeft: Spacing.sm }]}>
                    Uploading…
                  </Text>
                </View>
              ) : isDone ? (
                <View style={s.slotContent}>
                  <Image source={{ uri: url }} style={s.thumbnail} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.slotLabelDone}>{slot.label}</Text>
                    <Text style={s.slotSub}>Tap to replace</Text>
                  </View>
                  <Text style={s.checkmark}>✓</Text>
                </View>
              ) : (
                <View style={s.slotContent}>
                  <View style={s.slotIcon}>
                    <Text style={{ fontSize: 22 }}>{slot.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.slotLabel}>{slot.label}</Text>
                    <Text style={s.slotSub}>Tap to upload</Text>
                  </View>
                  <Text style={s.uploadArrow}>+</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[s.submitBtn, uploadedCount === 0 && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={uploadedCount === 0}
        >
          <Text style={s.submitBtnText}>
            {uploadedCount === 6
              ? "Submit Application →"
              : `Submit Application (${uploadedCount}/6 uploaded)`}
          </Text>
        </TouchableOpacity>

        <Text style={s.footerNote}>
          All documents are stored securely and only reviewed by our team.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    headerTitle: { fontSize: FontSize.xl, fontWeight: "700", color: C.text },
    headerSub: { fontSize: FontSize.sm, color: C.muted, marginTop: 2 },
    progressBg: {
      height: 3,
      backgroundColor: C.border,
      marginBottom: Spacing.sm,
    },
    progressFill: { height: 3, backgroundColor: C.brand },
    scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
    info: {
      fontSize: FontSize.sm,
      color: C.muted,
      marginBottom: Spacing.lg,
      lineHeight: 20,
    },
    slot: {
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      marginBottom: Spacing.sm,
      padding: Spacing.md,
      minHeight: 64,
      justifyContent: "center",
    },
    slotDone: {
      borderColor: "#22c55e",
      backgroundColor: "rgba(34,197,94,0.06)",
    },
    slotContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    slotLoading: { flexDirection: "row", alignItems: "center" },
    slotIcon: {
      width: 44,
      height: 44,
      borderRadius: Radius.sm,
      backgroundColor: C.inputBg,
      alignItems: "center",
      justifyContent: "center",
    },
    thumbnail: {
      width: 44,
      height: 44,
      borderRadius: Radius.sm,
    },
    slotLabel: { fontSize: FontSize.sm, color: C.text, fontWeight: "600" },
    slotLabelDone: {
      fontSize: FontSize.sm,
      color: "#22c55e",
      fontWeight: "600",
    },
    slotSub: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    checkmark: { fontSize: 18, color: "#22c55e", fontWeight: "700" },
    uploadArrow: { fontSize: 22, color: C.muted, fontWeight: "300" },
    submitBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      padding: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.lg,
    },
    submitBtnDisabled: { opacity: 0.4 },
    submitBtnText: { color: "#000", fontWeight: "700", fontSize: FontSize.md },
    footerNote: {
      fontSize: FontSize.xs,
      color: C.muted,
      textAlign: "center",
      marginTop: Spacing.md,
      lineHeight: 18,
    },
  });
