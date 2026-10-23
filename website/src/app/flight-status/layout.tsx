import type { ReactNode } from "react";
// Country flags (MIT-licensed SVGs from the flag-icons package, served from our own site).
// Only the flight status pages use them, so the stylesheet loads only here.
import "flag-icons/css/flag-icons.min.css";

export default function FlightStatusLayout({ children }: { children: ReactNode }) {
  return children;
}
