import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, Figtree } from "next/font/google";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import PreBookedNotice from "@/components/PreBookedNotice";
import { EMAIL, PHONE_E164, SITE_URL } from "@/lib/site";
import "./globals.css";

const heading = Familjen_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});

const TITLE = "OrangeRide | Pre-booked Gatwick airport transfers from Crawley & Horley";
const DESCRIPTION =
  "Fixed-fare, TfL-licensed private hire for Gatwick, Crawley and Horley, with London and Heathrow transfers. Book 24 hours ahead in the app or by WhatsApp, and we'll time your pickup to your flight's landing.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | OrangeRide" },
  description: DESCRIPTION,
  applicationName: "OrangeRide",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "/",
    siteName: "OrangeRide",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#2e3238",
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "TaxiService",
  name: "OrangeRide",
  url: SITE_URL,
  telephone: PHONE_E164,
  email: EMAIL,
  areaServed: [
    { "@type": "Place", name: "Gatwick" },
    { "@type": "City", name: "Crawley" },
    { "@type": "City", name: "Horley" },
    { "@type": "City", name: "London" },
    { "@type": "Place", name: "Heathrow" },
  ],
  provider: {
    "@type": "LocalBusiness",
    name: "OrangeRide",
    url: SITE_URL,
    telephone: PHONE_E164,
    email: EMAIL,
    image: `${SITE_URL}/images/logo-wordmark.png`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${heading.variable} ${body.variable}`}>
      <body className="min-h-screen bg-page font-sans text-body">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <PreBookedNotice />
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
