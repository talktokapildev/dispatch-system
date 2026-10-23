import { airlineLabel } from "@/lib/airlines";
import type { Weather, WeatherKind } from "@/lib/flightFormat";

// Airline label, country flag and weather icon for the flight status pages.
// Flags come from the flag-icons package (MIT, SVGs served from our own site); the stylesheet is
// imported once in app/flight-status/layout.tsx.

export function AirlineTag({
  iata,
  name,
  size = "md",
  short = false,
}: {
  iata: string | null | undefined;
  name: string | null | undefined;
  size?: "sm" | "md" | "lg";
  short?: boolean;
}) {
  const l = airlineLabel(iata, name);
  const cls =
    size === "lg"
      ? "rounded-[9px] px-3 py-2 text-[15px]"
      : size === "sm"
        ? "rounded-[6px] px-[7px] py-[2px] text-[11.5px]"
        : "rounded-[7px] px-[9px] py-1 text-[13px]";
  return (
    <span
      className={`inline-block whitespace-nowrap font-extrabold leading-tight tracking-[0.01em] ${cls}`}
      style={{ background: l.bg, color: l.fg }}
      title={l.name}
    >
      {short ? l.short : l.name}
    </span>
  );
}

/** Country flag (decorative: the city name next to it carries the meaning). */
export function Flag({ code, size = "md" }: { code: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const c = (code ?? "").toLowerCase();
  if (!/^[a-z]{2}$/.test(c)) return null;
  const dims = size === "lg" ? "h-[18px] w-6" : size === "sm" ? "h-3 w-4" : "h-[15px] w-5";
  return (
    <span
      aria-hidden
      className={`fi fi-${c} ${dims} flex-none rounded-[3px] bg-cover bg-center shadow-[0_0_0_1px_rgba(15,23,42,0.12)]`}
    />
  );
}

/** Small weather icon; the temperature or text beside it carries the meaning.
 *  `onDark`: lighter strokes for the dark header band (the moon was too faint there). */
export function WeatherIcon({
  kind,
  night = false,
  size = 18,
  onDark = false,
}: {
  kind: WeatherKind;
  night?: boolean;
  size?: number;
  onDark?: boolean;
}) {
  const SUN = onDark ? "#fbbf24" : "#e8a317";
  const GREY = onDark ? "#d1d5db" : "#7c8594";
  const BLUE = onDark ? "#93b4f5" : "#3b6fd8";
  const MOON = onDark ? "#dbe3ff" : "#6b7bb3";
  const SNOW = onDark ? "#bcd2f5" : "#5b8fd6";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "flex-none",
  };
  const cloud = "M17.5 18H7a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 12 3 3 0 0 1 17.5 18z";
  const rainCloud = "M17.5 15H7a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 9 3 3 0 0 1 17.5 15z";
  switch (kind) {
    case "clear":
      return night ? (
        <svg {...common} stroke={MOON}>
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </svg>
      ) : (
        <svg {...common} stroke={SUN}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "partly":
      return (
        <svg {...common}>
          {night ? (
            <path d="M11.5 7.5A4.5 4.5 0 0 1 6 12.4 4.5 4.5 0 1 0 11.5 7.5z" stroke={MOON} />
          ) : (
            <>
              <path d="M9 3v1.5M3.5 9H5M5.2 5.2l1 1M12.8 5.2l-1 1" stroke={SUN} />
              <path d="M6.4 11.2A3.5 3.5 0 1 1 12.5 8" stroke={SUN} />
            </>
          )}
          <path d="M18 20H9.5a3.5 3.5 0 1 1 .8-6.9A4.8 4.8 0 0 1 19 15a2.5 2.5 0 0 1-1 5z" stroke={GREY} />
        </svg>
      );
    case "cloudy":
      return (
        <svg {...common} stroke={GREY}>
          <path d={cloud} />
        </svg>
      );
    case "rain":
    case "drizzle":
      return (
        <svg {...common} stroke={BLUE}>
          <path d={rainCloud} />
          <path d={kind === "rain" ? "M8 18l-1 2M12 18l-1 2M16 18l-1 2" : "M8 19v.5M12 19v.5M16 19v.5"} />
        </svg>
      );
    case "snow":
      return (
        <svg {...common} stroke={SNOW}>
          <path d={rainCloud} />
          <path d="M8 19h.01M12 20h.01M16 19h.01M10 22h.01M14 22h.01" strokeWidth={2.6} />
        </svg>
      );
    case "thunder":
      return (
        <svg {...common}>
          <path d={rainCloud} stroke={GREY} />
          <path d="M12.5 13l-2 4h3l-2 4" stroke={SUN} />
        </svg>
      );
    case "fog":
      return (
        <svg {...common} stroke={GREY}>
          <path d="M4 9h16M3 13h18M5 17h14" />
        </svg>
      );
  }
}

/** "☁ 8°" inline (board rows). */
export function WeatherInline({ w, withText = false }: { w: Weather | undefined; withText?: boolean }) {
  if (!w) return null;
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-muted" title={w.text}>
      <WeatherIcon kind={w.kind} night={w.night} />
      <span>
        {withText ? `${w.text} ` : ""}
        {w.tempC}°
      </span>
      {!withText && <span className="sr-only">, {w.text}</span>}
    </span>
  );
}
