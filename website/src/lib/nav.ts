// Main navigation, shared by the desktop header and the mobile menu.
// Only room for 5–6 links: a 7th pushes the phone and "Get the app" buttons onto a second line.
// FAQs and "Flight tracking" (the home page section) are linked from the footer instead.
export type NavItem = { href: string; label: string; live?: boolean };

export const NAV: NavItem[] = [
  { href: "/#quote", label: "Get a price" },
  { href: "/flight-status", label: "Flight status", live: true }, // green "live" dot
  { href: "/#how", label: "How to book" },
  { href: "/#gatwick", label: "Gatwick" },
  { href: "/drivers", label: "Drive with us" },
];
