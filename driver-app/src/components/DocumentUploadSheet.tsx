// driver-app/src/components/DocumentUploadSheet.tsx
//
// Upload one document (new version, waits for review):
//   1. add page(s): Take photo / Choose from photos / Choose file (PDF)
//      — insurance and V5C can have up to 6 pages
//   2. expiry date (PCO badge, PHV vehicle licence, insurance, MOT) — today or later
//   3. Submit
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  Image,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { format } from "date-fns";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import type { DocItem } from "../hooks/useDocumentStatus";
import {
  EXPIRY_REQUIRED,
  MAX_PAGES,
  MULTI_PAGE,
  PickedPage,
  uploadDocument,
} from "../lib/documents";

interface Props {
  item: DocItem | null;
  vehiclePlate?: string | null;
  onClose: () => void;
  onUploaded: () => void;
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export function DocumentUploadSheet({ item, vehiclePlate, onClose, onUploaded }: Props) {
  const { Colors } = useTheme();
  const [pages, setPages] = useState<PickedPage[]>([]);
  const [expiry, setExpiry] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPages([]);
    setExpiry(null);
    setShowPicker(false);
    setBusy(false);
  }, [item?.type]);

  if (!item) return null;
  const needsExpiry = EXPIRY_REQUIRED.has(item.type);
  const multi = MULTI_PAGE.has(item.type);
  const canAdd = multi ? pages.length < MAX_PAGES : pages.length === 0;
  const title = item.owner === "vehicle" && vehiclePlate ? `${item.label} · ${vehiclePlate}` : item.label;

  const addPage = (p: PickedPage) =>
    setPages((prev) => (multi ? [...prev, p].slice(0, MAX_PAGES) : [p]));

  const fromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow camera access in Settings.");
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!r.canceled && r.assets?.[0])
      addPage({ uri: r.assets[0].uri, name: `page_${pages.length + 1}.jpg`, mimeType: "image/jpeg", isPdf: false });
  };

  const fromPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access in Settings.");
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsMultipleSelection: multi,
      selectionLimit: multi ? MAX_PAGES - pages.length : 1,
    });
    if (r.canceled) return;
    for (const a of r.assets ?? [])
      addPage({ uri: a.uri, name: a.fileName ?? "page.jpg", mimeType: a.mimeType ?? "image/jpeg", isPdf: false });
  };

  const fromFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
      multiple: multi,
    });
    if (r.canceled) return;
    for (const a of r.assets ?? []) {
      if (a.size && a.size > 10 * 1024 * 1024) {
        Alert.alert("File too large", `${a.name} is over 10 MB. Please choose a smaller file or take a photo.`);
        continue;
      }
      const mime = a.mimeType ?? (a.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      addPage({ uri: a.uri, name: a.name ?? "document", mimeType: mime, isPdf: mime === "application/pdf" });
    }
  };

  const choose = () =>
    Alert.alert(pages.length ? "Add another page" : "Add document", "How would you like to add it?", [
      { text: "Take photo", onPress: fromCamera },
      { text: "Choose from photos", onPress: fromPhotos },
      { text: "Choose file (PDF)", onPress: fromFiles },
      { text: "Cancel", style: "cancel" },
    ]);

  const openDate = () => {
    setTempDate(expiry ?? new Date());
    setShowPicker(true);
  };

  const submit = async () => {
    if (!pages.length) return;
    if (needsExpiry && !expiry) {
      Alert.alert("Expiry date needed", `Enter the expiry date shown on your ${item.label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    try {
      await uploadDocument(item.type, pages, needsExpiry ? expiry : null);
      Alert.alert(
        "Sent for review",
        item.state === "valid"
          ? "Thanks. Your current copy stays valid while OrangeRide checks the new one."
          : "Thanks. We'll let you know as soon as it's checked."
      );
      onUploaded();
      onClose();
    } catch (err: any) {
      Alert.alert("Upload failed", err?.response?.data?.error ?? "Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const s = styles(Colors);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.headerRow}>
            <Text style={s.title} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} disabled={busy} hitSlop={12}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.hint}>
            {multi
              ? "Add every page (up to 6). Make sure all the text is readable."
              : "Make sure the whole document is in the photo and readable."}
          </Text>

          <ScrollView horizontal contentContainerStyle={s.pages} showsHorizontalScrollIndicator={false}>
            {pages.map((p, i) => (
              <View key={p.uri + i} style={s.page}>
                {p.isPdf ? (
                  <View style={s.pdf}>
                    <Text style={s.pdfIcon}>📄</Text>
                    <Text style={s.pdfName} numberOfLines={2}>
                      {p.name}
                    </Text>
                  </View>
                ) : (
                  <Image source={{ uri: p.uri }} style={s.thumb} />
                )}
                <TouchableOpacity
                  style={s.remove}
                  onPress={() => setPages((prev) => prev.filter((_, j) => j !== i))}
                  disabled={busy}
                >
                  <Text style={s.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {canAdd && (
              <TouchableOpacity style={[s.page, s.addPage]} onPress={choose} disabled={busy}>
                <Text style={s.addPlus}>＋</Text>
                <Text style={s.addText}>{pages.length ? "Add page" : "Add document"}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {needsExpiry && (
            <TouchableOpacity style={[s.expiryRow, !expiry && s.expiryRowEmpty]} onPress={openDate} disabled={busy}>
              <Text style={s.expiryLabel}>📅 Expiry date</Text>
              <Text style={[s.expiryValue, !expiry && { color: Colors.brand }]}>
                {expiry ? format(expiry, "dd MMM yyyy") : "Set date"}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[s.submit, (!pages.length || (needsExpiry && !expiry) || busy) && s.submitDisabled]}
            onPress={submit}
            disabled={!pages.length || (needsExpiry && !expiry) || busy}
          >
            {busy ? <ActivityIndicator color="#000" /> : <Text style={s.submitText}>Send for review</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* iOS: spinner in a sheet */}
      {showPicker && Platform.OS === "ios" && (
        <Modal transparent animationType="slide">
          <View style={s.overlay}>
            <View style={s.dateSheet}>
              <View style={s.dateHeader}>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text style={s.dateCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={s.dateTitle}>Expiry date</Text>
                <TouchableOpacity
                  onPress={() => {
                    setExpiry(tempDate);
                    setShowPicker(false);
                  }}
                >
                  <Text style={s.dateDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                minimumDate={startOfToday()}
                onChange={(_, d) => d && setTempDate(d)}
              />
            </View>
          </View>
        </Modal>
      )}
      {/* Android: system dialog */}
      {showPicker && Platform.OS === "android" && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          minimumDate={startOfToday()}
          onChange={(event, d) => {
            setShowPicker(false);
            if (event.type !== "dismissed" && d) setExpiry(d);
          }}
        />
      )}
    </Modal>
  );
}

const styles = (Colors: any) =>
  StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
      backgroundColor: Colors.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      padding: Spacing.lg,
      paddingBottom: Spacing.xl,
      gap: Spacing.md,
    },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm },
    title: { flex: 1, fontSize: FontSize.lg, fontWeight: "700", color: Colors.white },
    close: { fontSize: FontSize.lg, color: Colors.muted },
    hint: { fontSize: FontSize.sm, color: Colors.muted, marginTop: -Spacing.sm },
    pages: { gap: Spacing.sm, paddingVertical: Spacing.xs },
    page: {
      width: 96,
      height: 120,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: Colors.border,
      overflow: "hidden",
      backgroundColor: Colors.inputBg,
    },
    thumb: { width: "100%", height: "100%" },
    pdf: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xs },
    pdfIcon: { fontSize: 28 },
    pdfName: { fontSize: FontSize.xs, color: Colors.muted, textAlign: "center", marginTop: 4 },
    remove: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },
    removeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
    addPage: { alignItems: "center", justifyContent: "center", borderStyle: "dashed", borderColor: Colors.brand },
    addPlus: { fontSize: 26, color: Colors.brand },
    addText: { fontSize: FontSize.xs, color: Colors.brand, fontWeight: "600", marginTop: 2 },
    expiryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: Colors.border,
      backgroundColor: Colors.inputBg,
    },
    expiryRowEmpty: { borderColor: Colors.brand },
    expiryLabel: { fontSize: FontSize.md, color: Colors.text },
    expiryValue: { fontSize: FontSize.md, color: Colors.white, fontWeight: "600" },
    submit: {
      backgroundColor: Colors.brand,
      borderRadius: Radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    submitDisabled: { opacity: 0.4 },
    submitText: { color: "#000", fontSize: FontSize.md, fontWeight: "700" },
    dateSheet: { backgroundColor: Colors.card, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingBottom: Spacing.xl },
    dateHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    dateCancel: { color: Colors.muted, fontSize: FontSize.md },
    dateTitle: { color: Colors.white, fontSize: FontSize.md, fontWeight: "600" },
    dateDone: { color: Colors.brand, fontSize: FontSize.md, fontWeight: "700" },
  });
