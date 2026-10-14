import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import LegalLayout from "@/components/legal/LegalLayout";
import {
  PRIVACY_INTRO,
  PRIVACY_OTHER,
  PRIVACY_SECTIONS,
  PRIVACY_SUMMARY,
  PRIVACY_UPDATED,
} from "@/content/privacy";

export const metadata: Metadata = pageMetadata("/privacy", "Privacy Policy", PRIVACY_INTRO);

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={PRIVACY_INTRO}
      updated={PRIVACY_UPDATED}
      other={PRIVACY_OTHER}
      summary={PRIVACY_SUMMARY}
      sections={PRIVACY_SECTIONS}
    />
  );
}
