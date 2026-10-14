// Inline SVG icons copied from the canvas. All decorative (aria-hidden).

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function CalendarIcon({ size = 16, color = "#f59e0b", strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function PhoneIcon({ size = 16, color = "#2e3238", strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  );
}

export function ChatIcon({ size = 20, color = "#2e3238", strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4A8 8 0 1 1 20 12z" />
    </svg>
  );
}

export function CheckIcon({ size = 16, color = "#2e3238", strokeWidth = 3 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function ShieldIcon({ size = 22, color = "#ffffff", strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function PersonIcon({ size = 22, color = "#ffffff", strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
    </svg>
  );
}

export function BriefcaseIcon({ size = 22, color = "#ffffff", strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <path d="M4 7h16v10H4z" />
      <path d="M8 7V5h8v2M9 12h6" />
    </svg>
  );
}

export function CardIcon({ size = 22, color = "#d97706", strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

export function PinIcon({ size = 15, color = "#ef4444", strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size)} stroke={color} strokeWidth={strokeWidth}>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function PlaneIcon({ size = 18, color = "#2e3238" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z" />
    </svg>
  );
}
