import Arrivals from "@/components/home/Arrivals";
import DriveWithUs from "@/components/home/DriveWithUs";
import Faq from "@/components/home/Faq";
import FinalCta from "@/components/home/FinalCta";
import Gatwick from "@/components/home/Gatwick";
import Hero from "@/components/home/Hero";
import HowToBook from "@/components/home/HowToBook";
import TrustRow from "@/components/home/TrustRow";
import WhyOrangeRide from "@/components/home/WhyOrangeRide";

// Each section is self-contained; swap one for an interactive version without touching the others.
export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustRow />
      <Arrivals />
      <WhyOrangeRide />
      <HowToBook />
      <Gatwick />
      <DriveWithUs />
      <Faq />
      <FinalCta />
    </>
  );
}
