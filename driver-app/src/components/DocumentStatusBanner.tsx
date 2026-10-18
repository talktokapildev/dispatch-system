// driver-app/src/components/DocumentStatusBanner.tsx
//
// Home screen banner from the server's document status:
//   - red: documents stop you taking jobs (the server's one-line reason)
//   - amber: all valid, but something expires within 30 days (upload the renewal)
//   - nothing when all is fine
// Tap → Documents.
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { DispatchEligibility, DOC_LABELS, DocType } from "../hooks/useDocumentStatus";

interface Props {
  eligibility: DispatchEligibility | null;
  onPress: () => void;
}

export function DocumentStatusBanner({ eligibility, onPress }: Props) {
  if (!eligibility) return null;

  let tone: "red" | "amber" | null = null;
  let title = "";
  let body = "";

  if (!eligibility.eligible) {
    tone = "red";
    title = eligibility.enforced === false ? "Documents need attention" : "You can't take jobs right now";
    body =
      eligibility.message ||
      // Older server: build a line from the lists
      [...eligibility.expiredDocs, ...eligibility.rejectedDocs, ...eligibility.missingDocs, ...eligibility.pendingDocs]
        .map((t) => DOC_LABELS[t as DocType] ?? t)
        .join(", ");
  } else {
    // Soonest expiry without a renewal already uploaded
    const soon = (eligibility.expiringSoon ?? [])
      .filter((i) => !i.pendingReview)
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
    if (soon) {
      tone = "amber";
      const what =
        soon.owner === "vehicle" && eligibility.vehicle
          ? `${soon.label} (${eligibility.vehicle.licensePlate})`
          : soon.label;
      const when =
        soon.daysLeft === 0 ? "today" : soon.daysLeft === 1 ? "tomorrow" : `in ${soon.daysLeft} days`;
      title = `${what} expires ${when}`;
      body = "Upload the renewal now so you can keep taking jobs.";
    }
  }

  if (!tone) return null;
  const bg = tone === "red" ? "#dc2626" : "#ea580c";

  return (
    <TouchableOpacity style={[styles.container, { backgroundColor: bg }]} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.icon}>{tone === "red" ? "⛔" : "⚠️"}</Text>
      <View style={styles.textBox}>
        <Text style={styles.title}>{title}</Text>
        {!!body && <Text style={styles.body}>{body}</Text>}
        <Text style={styles.cta}>Open Documents →</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  icon: { fontSize: 18, marginTop: 1 },
  textBox: { flex: 1 },
  title: { color: "#fff", fontWeight: "700", fontSize: 14 },
  body: { color: "#fff", fontSize: 13, marginTop: 3, opacity: 0.95 },
  cta: { color: "#fff", fontSize: 12, fontWeight: "700", marginTop: 8 },
});
