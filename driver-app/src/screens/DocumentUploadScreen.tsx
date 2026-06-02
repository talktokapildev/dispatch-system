// driver-app/src/screens/DocumentUploadScreen.tsx
// Step 2 of the self-onboarding flow.
// - Images upload immediately on pick/capture.
// - PHV, Insurance, MOT, DBS slots show expiry date picker after upload.
// - V5C and Insurance support multiple pages.
// - "Submit Application" navigates to ApplicationPendingScreen.

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
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { format } from "date-fns";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

type RouteParams = { applicationId: string };

type DocSlot = {
  key: string;
  label: string;
  emoji: string;
  requiresExpiry?: boolean;
  multiFile?: boolean;
};

const DOCUMENT_SLOTS: DocSlot[] = [
  { key: "docPcoBadge", label: "PCO Badge", emoji: "🪪" },
  { key: "docDrivingLicFront", label: "Driving Licence (Front)", emoji: "🪪" },
  { key: "docDrivingLicBack", label: "Driving Licence (Back)", emoji: "🪪" },
  {
    key: "docPhvLicence",
    label: "PHV Licence",
    emoji: "📄",
    requiresExpiry: true,
  },
  {
    key: "docInsurance",
    label: "Insurance Certificate",
    emoji: "🛡️",
    requiresExpiry: true,
    multiFile: true,
  },
  {
    key: "docMot",
    label: "MOT Certificate",
    emoji: "🔧",
    requiresExpiry: true,
  },
  {
    key: "docDbs",
    label: "DBS Certificate",
    emoji: "✅",
    requiresExpiry: true,
  },
  { key: "docV5c", label: "V5C Logbook", emoji: "📋", multiFile: true },
];

// Keys for single-file slots only
type SingleDocKey =
  | "docPcoBadge"
  | "docDrivingLicFront"
  | "docDrivingLicBack"
  | "docPhvLicence"
  | "docMot"
  | "docDbs";

const SINGLE_SLOTS = DOCUMENT_SLOTS.filter((slot) => !slot.multiFile);
const MULTI_SLOTS = DOCUMENT_SLOTS.filter((slot) => !!slot.multiFile);

export default function DocumentUploadScreen() {
  const { Colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const { applicationId } = route.params;

  // Single-file slot URLs
  const [uploaded, setUploaded] = useState<Record<SingleDocKey, string | null>>(
    {
      docPcoBadge: null,
      docDrivingLicFront: null,
      docDrivingLicBack: null,
      docPhvLicence: null,
      docMot: null,
      docDbs: null,
    }
  );

  // Multi-file slot page arrays
  const [multiPages, setMultiPages] = useState<Record<string, string[]>>({
    docInsurance: [],
    docV5c: [],
  });

  // Per-slot uploading spinner
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  // Expiry dates (only for requiresExpiry slots)
  const [expiryDates, setExpiryDates] = useState<Record<string, Date>>({});
  const [savingExpiry, setSavingExpiry] = useState<string | null>(null);

  // Date picker state
  const [datePickerSlot, setDatePickerSlot] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  // Count: single-file + multi-file (1 per multi slot if ≥1 page)
  const uploadedCount =
    Object.values(uploaded).filter(Boolean).length +
    Object.values(multiPages).filter((pages) => pages.length > 0).length;

  const totalSlots = DOCUMENT_SLOTS.length;

  // ── Permissions + pick ───────────────────────────────────────────────────
  const pickBase64 = async (useCamera: boolean): Promise<string | null> => {
    if (useCamera) {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required.");
        return null;
      }
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Photo library access is required.");
        return null;
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

    if (result.canceled || !result.assets?.[0]?.base64) return null;
    return result.assets[0].base64!;
  };

  const showPickerAlert = (
    label: string,
    onPick: (useCamera: boolean) => void
  ) => {
    Alert.alert(label, "How would you like to add this document?", [
      { text: "Take Photo", onPress: () => onPick(true) },
      { text: "Choose from Library", onPress: () => onPick(false) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // ── Upload to backend ────────────────────────────────────────────────────
  const uploadToBackend = async (
    docKey: string,
    base64: string
  ): Promise<string | null> => {
    setUploading((u) => ({ ...u, [docKey]: true }));
    try {
      const { data } = await api.post(
        `/driver-applications/${applicationId}/documents`,
        { docType: docKey, image: `data:image/jpeg;base64,${base64}` }
      );
      return data.url as string;
    } catch (err: any) {
      Alert.alert(
        "Upload failed",
        err.response?.data?.error ??
          "Could not upload document. Please try again."
      );
      return null;
    } finally {
      setUploading((u) => ({ ...u, [docKey]: false }));
    }
  };

  // ── Single-file slot handler ─────────────────────────────────────────────
  const handleSingleSlot = (slot: DocSlot) => {
    showPickerAlert(slot.label, async (useCamera) => {
      const base64 = await pickBase64(useCamera);
      if (!base64) return;
      const url = await uploadToBackend(slot.key, base64);
      if (!url) return;
      setUploaded((u) => ({ ...u, [slot.key as SingleDocKey]: url }));
      // Auto-open expiry picker after successful upload
      if (slot.requiresExpiry) {
        setTempDate(expiryDates[slot.key] ?? new Date());
        setDatePickerSlot(slot.key);
      }
    });
  };

  // ── Multi-file slot handler ──────────────────────────────────────────────
  const handleAddPage = (slot: DocSlot) => {
    const pageCount = multiPages[slot.key]?.length ?? 0;
    const title =
      pageCount === 0
        ? `${slot.label} — Upload first page`
        : `${slot.label} — Add page ${pageCount + 1}`;

    showPickerAlert(title, async (useCamera) => {
      const base64 = await pickBase64(useCamera);
      if (!base64) return;
      const url = await uploadToBackend(slot.key, base64);
      if (!url) return;
      setMultiPages((m) => ({
        ...m,
        [slot.key]: [...(m[slot.key] ?? []), url],
      }));
      // Auto-open expiry picker after first page upload (if requiresExpiry)
      if (slot.requiresExpiry && pageCount === 0) {
        setTempDate(expiryDates[slot.key] ?? new Date());
        setDatePickerSlot(slot.key);
      }
    });
  };

  // ── Expiry date save ─────────────────────────────────────────────────────
  const saveExpiry = async (docKey: string, date: Date) => {
    setExpiryDates((e) => ({ ...e, [docKey]: date }));
    setSavingExpiry(docKey);
    try {
      await api.patch(
        `/driver-applications/${applicationId}/documents/${docKey}/expiry`,
        { expiryDate: date.toISOString() }
      );
    } catch {
      // Non-blocking — date is saved locally; backend will sync on next operation
    } finally {
      setSavingExpiry(null);
    }
  };

  const openExpiryPicker = (docKey: string) => {
    setTempDate(expiryDates[docKey] ?? new Date());
    setDatePickerSlot(docKey);
  };

  const handleDateConfirmIOS = () => {
    if (!datePickerSlot) return;
    saveExpiry(datePickerSlot, tempDate);
    setDatePickerSlot(null);
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (uploadedCount < totalSlots) {
      Alert.alert(
        "Missing documents",
        `You have uploaded ${uploadedCount} of ${totalSlots} documents. You can submit now and upload the remaining later, but your application may be delayed.`,
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

  // ── Styles ───────────────────────────────────────────────────────────────
  const s = styles(Colors);

  // ── Render helpers ───────────────────────────────────────────────────────
  const renderExpiryRow = (slot: DocSlot) => {
    if (!slot.requiresExpiry) return null;
    const isSlotUploaded = slot.multiFile
      ? (multiPages[slot.key]?.length ?? 0) > 0
      : !!uploaded[slot.key as SingleDocKey];
    if (!isSlotUploaded) return null;

    const expiry = expiryDates[slot.key];
    const isSaving = savingExpiry === slot.key;

    return (
      <TouchableOpacity
        key={`expiry-${slot.key}`}
        style={[s.expiryRow, expiry ? s.expiryRowSet : s.expiryRowUnset]}
        onPress={() => openExpiryPicker(slot.key)}
        disabled={isSaving}
        activeOpacity={0.7}
      >
        {isSaving ? (
          <ActivityIndicator
            size="small"
            color={Colors.brand}
            style={{ marginRight: Spacing.sm }}
          />
        ) : (
          <Text style={s.expiryIcon}>📅</Text>
        )}
        <Text style={[s.expiryText, expiry && s.expiryTextSet]}>
          {expiry
            ? `Expiry: ${format(expiry, "dd MMM yyyy")} ✓`
            : "Set expiry date (required)"}
        </Text>
        {!expiry && <Text style={s.expiryChevron}>›</Text>}
      </TouchableOpacity>
    );
  };

  const renderSingleSlot = (slot: DocSlot) => {
    const isUploading = !!uploading[slot.key];
    const url = uploaded[slot.key as SingleDocKey];
    const isDone = !!url;

    return (
      <View key={slot.key}>
        <TouchableOpacity
          style={[s.slot, isDone && s.slotDone]}
          onPress={() => handleSingleSlot(slot)}
          disabled={isUploading}
          activeOpacity={0.7}
        >
          {isUploading ? (
            <View style={s.slotRow}>
              <ActivityIndicator color={Colors.brand} />
              <Text style={[s.slotLabel, { marginLeft: Spacing.sm }]}>
                Uploading…
              </Text>
            </View>
          ) : isDone ? (
            <View style={s.slotRow}>
              <Image source={{ uri: url! }} style={s.thumbnail} />
              <View style={{ flex: 1 }}>
                <Text style={s.slotLabelDone}>{slot.label}</Text>
                <Text style={s.slotSub}>Tap to replace</Text>
              </View>
              <Text style={s.checkmark}>✓</Text>
            </View>
          ) : (
            <View style={s.slotRow}>
              <View style={s.slotIcon}>
                <Text style={{ fontSize: 22 }}>{slot.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.slotLabel}>{slot.label}</Text>
                <Text style={s.slotSub}>Tap to upload</Text>
              </View>
              <Text style={s.uploadPlus}>+</Text>
            </View>
          )}
        </TouchableOpacity>
        {renderExpiryRow(slot)}
      </View>
    );
  };

  const renderMultiSlot = (slot: DocSlot) => {
    const pages = multiPages[slot.key] ?? [];
    const isUploading = !!uploading[slot.key];
    const hasPages = pages.length > 0;

    return (
      <View key={slot.key}>
        <View style={[s.slot, s.slotMulti, hasPages && s.slotDone]}>
          {/* Header row */}
          <View style={s.slotRow}>
            <View style={s.slotIcon}>
              <Text style={{ fontSize: 22 }}>{slot.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={hasPages ? s.slotLabelDone : s.slotLabel}>
                {slot.label}
              </Text>
              <Text style={s.slotSub}>
                {hasPages
                  ? `${pages.length} page${
                      pages.length > 1 ? "s" : ""
                    } uploaded`
                  : "Upload each page separately"}
              </Text>
            </View>
            {hasPages && <Text style={s.checkmark}>✓</Text>}
          </View>

          {/* Page thumbnails */}
          {hasPages && (
            <View style={s.pagesRow}>
              {pages.map((pageUrl, idx) => (
                <View key={idx} style={s.pageThumbWrap}>
                  <Image source={{ uri: pageUrl }} style={s.pageThumb} />
                  <Text style={s.pageThumbLabel}>pg {idx + 1}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Add page button */}
          <TouchableOpacity
            style={[s.addPageBtn, isUploading && s.addPageBtnDisabled]}
            onPress={() => handleAddPage(slot)}
            disabled={isUploading}
            activeOpacity={0.7}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color={Colors.brand} />
            ) : (
              <Text style={s.addPageBtnText}>
                {hasPages
                  ? `+ Add page ${pages.length + 1}`
                  : "+ Upload first page"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
        {renderExpiryRow(slot)}
      </View>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={s.headerTitle}>Upload Documents</Text>
          <Text style={s.headerSub}>
            {uploadedCount} of {totalSlots} uploaded
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={s.progressBg}>
        <View
          style={[
            s.progressFill,
            { width: `${(uploadedCount / totalSlots) * 100}%` as any },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.info}>
          Tap each document to upload a photo. For multi-page documents, upload
          each page separately.
        </Text>

        {DOCUMENT_SLOTS.map((slot) =>
          slot.multiFile ? renderMultiSlot(slot) : renderSingleSlot(slot)
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[s.submitBtn, uploadedCount === 0 && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={uploadedCount === 0}
        >
          <Text style={s.submitBtnText}>
            {uploadedCount === totalSlots
              ? "Submit Application →"
              : `Submit Application (${uploadedCount}/${totalSlots} uploaded)`}
          </Text>
        </TouchableOpacity>

        <Text style={s.footerNote}>
          All documents are stored securely and only reviewed by our team.
        </Text>
      </ScrollView>

      {/* ── iOS Date Picker Modal ───────────────────────────────────────── */}
      {Platform.OS === "ios" && datePickerSlot !== null && (
        <Modal transparent animationType="slide">
          <View style={s.dateOverlay}>
            <View style={s.dateSheet}>
              <View style={s.dateSheetHeader}>
                <TouchableOpacity onPress={() => setDatePickerSlot(null)}>
                  <Text style={s.dateCancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={s.dateTitleText}>Expiry Date</Text>
                <TouchableOpacity onPress={handleDateConfirmIOS}>
                  <Text style={s.dateDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={(_, date) => {
                  if (date) setTempDate(date);
                }}
                minimumDate={new Date()}
              />
            </View>
          </View>
        </Modal>
      )}

      {/* ── Android Date Picker (dialog) ────────────────────────────────── */}
      {Platform.OS === "android" && datePickerSlot !== null && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={(event, date) => {
            const slot = datePickerSlot;
            setDatePickerSlot(null);
            if (event.type !== "dismissed" && date && slot) {
              saveExpiry(slot, date);
            }
          }}
          minimumDate={new Date()}
        />
      )}
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
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
      gap: Spacing.sm,
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
    headerText: { flex: 1 },
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

    // Slot
    slot: {
      backgroundColor: C.card,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      marginBottom: Spacing.xs,
      padding: Spacing.md,
      minHeight: 64,
      justifyContent: "center",
    },
    slotDone: {
      borderColor: "#22c55e",
      backgroundColor: "rgba(34,197,94,0.06)",
    },
    slotMulti: { minHeight: 72 },
    slotRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
    slotIcon: {
      width: 44,
      height: 44,
      borderRadius: Radius.sm,
      backgroundColor: C.inputBg,
      alignItems: "center",
      justifyContent: "center",
    },
    thumbnail: { width: 44, height: 44, borderRadius: Radius.sm },
    slotLabel: { fontSize: FontSize.sm, color: C.text, fontWeight: "600" },
    slotLabelDone: {
      fontSize: FontSize.sm,
      color: "#22c55e",
      fontWeight: "600",
    },
    slotSub: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    checkmark: { fontSize: 18, color: "#22c55e", fontWeight: "700" },
    uploadPlus: { fontSize: 22, color: C.muted, fontWeight: "300" },

    // Multi-page thumbnails
    pagesRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    pageThumbWrap: { alignItems: "center", gap: 4 },
    pageThumb: { width: 52, height: 52, borderRadius: Radius.sm },
    pageThumbLabel: { fontSize: 10, color: C.muted },

    // Add page button
    addPageBtn: {
      marginTop: Spacing.sm,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: C.brand,
      borderStyle: "dashed",
      paddingVertical: Spacing.sm,
      alignItems: "center",
    },
    addPageBtnDisabled: { opacity: 0.5 },
    addPageBtnText: {
      fontSize: FontSize.sm,
      color: C.brand,
      fontWeight: "600",
    },

    // Expiry row (sits between slot and next slot)
    expiryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      backgroundColor: C.inputBg,
      borderRadius: Radius.sm,
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: 10,
      marginBottom: Spacing.sm,
    },
    expiryRowUnset: { borderColor: "#f97316", borderStyle: "dashed" },
    expiryRowSet: { borderColor: "#22c55e55", borderStyle: "solid" },
    expiryIcon: { fontSize: 16 },
    expiryText: {
      flex: 1,
      fontSize: FontSize.sm,
      color: "#f97316",
      fontWeight: "600",
    },
    expiryTextSet: { color: "#22c55e" },
    expiryChevron: { fontSize: 20, color: C.muted },

    // Submit
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

    // Date picker modal (iOS)
    dateOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    dateSheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingBottom: Spacing.xl,
    },
    dateSheetHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    dateCancelText: {
      fontSize: FontSize.sm,
      color: C.muted,
      fontWeight: "600",
    },
    dateTitleText: { fontSize: FontSize.sm, color: C.text, fontWeight: "700" },
    dateDoneText: { fontSize: FontSize.sm, color: C.brand, fontWeight: "700" },
  });
