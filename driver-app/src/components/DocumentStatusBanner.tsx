// driver-app/src/components/DocumentStatusBanner.tsx
//
// Drop this banner into HomeScreen directly below the header/greeting.
// It is invisible when the driver is fully compliant (eligible === true).
//
// Usage in HomeScreen:
//   import { DocumentStatusBanner } from "../components/DocumentStatusBanner";
//   const { eligibility } = useDocumentStatus();
//   ...
//   <DocumentStatusBanner eligibility={eligibility} onPress={() => navigation.navigate("Documents")} />

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import {
  DispatchEligibility,
  DOC_LABELS,
  DocType,
} from "../hooks/useDocumentStatus";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  eligibility: DispatchEligibility | null;
  /** Navigate to the Documents screen so the driver can check progress */
  onPress: () => void;
}

export function DocumentStatusBanner({ eligibility, onPress }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Nothing to show when compliant or data not yet loaded
  if (!eligibility || eligibility.eligible) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  // Build a flat list of problem items with their category label
  const problems: { label: string; tag: string; tagColor: string }[] = [
    ...eligibility.rejectedDocs.map((t) => ({
      label: DOC_LABELS[t as DocType] ?? t,
      tag: "Rejected",
      tagColor: "#ef4444",
    })),
    ...eligibility.expiredDocs.map((t) => ({
      label: DOC_LABELS[t as DocType] ?? t,
      tag: "Expired",
      tagColor: "#f97316",
    })),
    ...eligibility.missingDocs.map((t) => ({
      label: DOC_LABELS[t as DocType] ?? t,
      tag: "Missing",
      tagColor: "#6b7280",
    })),
    ...eligibility.pendingDocs.map((t) => ({
      label: DOC_LABELS[t as DocType] ?? t,
      tag: "Pending review",
      tagColor: "#f59e0b",
    })),
  ];

  const hasPendingOnly =
    eligibility.missingDocs.length === 0 &&
    eligibility.rejectedDocs.length === 0 &&
    eligibility.expiredDocs.length === 0 &&
    eligibility.pendingDocs.length > 0;

  return (
    <View style={styles.container}>
      {/* ── Header row ─────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.header}
        onPress={toggle}
        activeOpacity={0.8}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>⚠</Text>
          <View>
            <Text style={styles.title}>You won't receive jobs yet</Text>
            <Text style={styles.subtitle}>
              {hasPendingOnly
                ? `${eligibility.pendingDocs.length} document${
                    eligibility.pendingDocs.length > 1 ? "s" : ""
                  } pending admin review`
                : `${problems.length} document issue${
                    problems.length > 1 ? "s" : ""
                  } to resolve`}
            </Text>
          </View>
        </View>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {/* ── Expanded detail ─────────────────────────────────────── */}
      {expanded && (
        <View style={styles.detail}>
          {problems.map((p, i) => (
            <View key={i} style={styles.row}>
              <Text style={styles.docLabel}>{p.label}</Text>
              <View
                style={[styles.tag, { backgroundColor: p.tagColor + "22" }]}
              >
                <Text style={[styles.tagText, { color: p.tagColor }]}>
                  {p.tag}
                </Text>
              </View>
            </View>
          ))}

          <TouchableOpacity style={styles.cta} onPress={onPress}>
            <Text style={styles.ctaText}>View my documents →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    borderWidth: 1,
    borderColor: "#ff8c1a44",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    backgroundColor: "#ff8c1a",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  headerIcon: {
    color: "#fff",
    fontSize: 16,
    marginRight: 10,
  },
  chevron: {
    color: "#fff",
    fontSize: 12,
  },
  title: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  subtitle: {
    color: "#fff",
    fontSize: 12,
    opacity: 0.85,
    marginTop: 1,
  },
  detail: {
    padding: 14,
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  docLabel: {
    color: "#e5e7eb",
    fontSize: 13,
    flex: 1,
  },
  tag: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  tagText: {
    fontSize: 11,
    fontWeight: "600",
  },
  cta: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#374151",
  },
  ctaText: {
    color: "#ff8c1a",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
