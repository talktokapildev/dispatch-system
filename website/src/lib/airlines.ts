// Airline labels on the flight status pages: the airline's name in its main colour (no logos —
// those are trademarks). Text colour is picked per airline so every label passes WCAG AA
// (4.5:1); checked when this list was made. Airlines not listed get the grey label.
//
// Keyed by IATA code (what the flight data gives us). Several codes can share a label.

export type AirlineLabel = { name: string; short: string; bg: string; fg: string };

const DARK = "#1F2328";
const WHITE = "#FFFFFF";

const L = (name: string, bg: string, fg: string, short = name): AirlineLabel => ({ name, short, bg, fg });

const EASYJET = L("easyJet", "#FF6600", DARK);
const WIZZ = L("Wizz Air", "#C6007E", WHITE, "Wizz");
const NORWEGIAN = L("Norwegian", "#D81939", WHITE);
const RYANAIR = L("Ryanair", "#073590", WHITE);
const TUI = L("TUI", "#0B2A5B", WHITE);

const LABELS: Record<string, AirlineLabel> = {
  U2: EASYJET,
  DS: EASYJET,
  EC: EASYJET,
  BA: L("British Airways", "#1B3F7A", WHITE, "BA"),
  BY: TUI,
  X3: TUI,
  W6: WIZZ,
  W4: WIZZ,
  W9: WIZZ,
  FR: RYANAIR,
  RK: RYANAIR,
  VY: L("Vueling", "#FFCC00", DARK),
  DY: NORWEGIAN,
  D8: NORWEGIAN,
  EK: L("Emirates", "#C8102E", WHITE),
  QR: L("Qatar Airways", "#5C0632", WHITE, "Qatar"),
  TK: L("Turkish Airlines", "#C70A0C", WHITE, "Turkish"),
  VS: L("Virgin Atlantic", "#B5121B", WHITE, "Virgin"),
  LS: L("Jet2", "#E30613", WHITE),
  EI: L("Aer Lingus", "#006272", WHITE),
  WS: L("WestJet", "#00747A", WHITE),
  FI: L("Icelandair", "#003C71", WHITE),
  PC: L("Pegasus", "#FDC300", DARK),
  XQ: L("SunExpress", "#FFC72C", DARK),
  EW: L("Eurowings", "#A6005A", WHITE),
  KM: L("KM Malta", "#D11F2E", WHITE),
  DL: L("Delta", "#003366", WHITE),
  LM: L("Loganair", "#002F5F", WHITE),
  UX: L("Air Europa", "#003F87", WHITE),
  A3: L("Aegean", "#0A3874", WHITE),
  AT: L("Royal Air Maroc", "#C1272D", WHITE, "RAM"),
  I2: L("Iberia Express", "#D7192D", WHITE, "Iberia Exp."),
};

/** The label for an airline; unknown airlines get a neutral grey label with their own name. */
export function airlineLabel(iata: string | null | undefined, name: string | null | undefined): AirlineLabel {
  const known = iata ? LABELS[iata.toUpperCase()] : undefined;
  if (known) return known;
  const n = name?.trim() || iata || "Airline";
  return { name: n, short: n.length > 14 ? (iata ?? n.slice(0, 12)) : n, bg: "#E5E7EB", fg: DARK };
}
