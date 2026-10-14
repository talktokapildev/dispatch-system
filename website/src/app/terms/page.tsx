import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import LegalLayout from "@/components/legal/LegalLayout";
import {
  TERMS_INTRO,
  TERMS_OTHER,
  TERMS_SECTIONS,
  TERMS_SUMMARY,
  TERMS_UPDATED,
} from "@/content/terms";

export const metadata: Metadata = pageMetadata("/terms", "Terms & Conditions", TERMS_INTRO);

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms & Conditions"
      intro={TERMS_INTRO}
      updated={TERMS_UPDATED}
      other={TERMS_OTHER}
      summary={TERMS_SUMMARY}
      sections={TERMS_SECTIONS}
    />
  );
}
