import type { ReactNode } from "react";
import { TONE, Tone, Weather, WEATHER_CREDIT } from "@/lib/flightFormat";
import { WeatherIcon } from "./bits";

// Small shared pieces for the flight status pages.

export const h2 = "m-0 font-heading text-[clamp(24px,2.6vw,28px)] font-bold tracking-[-0.02em] text-ink";
export const eyebrow = "text-[13.5px] font-extrabold tracking-[0.08em]";

/** Status pill, e.g. "In the air · 9 min late". */
export function StatusPill({ tone, children, small = false }: { tone: Tone; children: ReactNode; small?: boolean }) {
  const t = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] font-extrabold ${t.pill} ${
        small ? "px-[10px] py-[3px] text-[13.5px]" : "px-4 py-2 text-[15px]"
      }`}
    >
      {!small && <span className={`h-[9px] w-[9px] rounded-full ${t.dot}`} aria-hidden />}
      {children}
    </span>
  );
}

/** Side-view plane (points right). */
export function PlaneMark({ size = 22, color = "#fbbf24" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: "rotate(45deg)" }}
    >
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
}

/** A small labelled fact ("Terminal · North"). */
export function Fact({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px] rounded-[18px] border border-line bg-white p-4 sm:p-[18px]">
      <span className="text-[13.5px] font-bold text-muted">{label}</span>
      <strong className="text-[20px] leading-tight text-ink sm:text-[22px]">{value}</strong>
      {note && <span className="text-[14px] text-muted">{note}</span>}
    </div>
  );
}

/** The dark band at the top of both pages (heading, Gatwick's weather now, search form). */
export function DarkBand({ heading, children, gatwick }: { heading: ReactNode; children: ReactNode; gatwick?: Weather }) {
  return (
    <section className="bg-ink text-[#d1d5db]">
      <div className="mx-auto flex max-w-site flex-col gap-[18px] px-4 pb-[104px] pt-9 sm:gap-[22px] sm:px-6 sm:pb-[132px] sm:pt-14">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <span className={`${eyebrow} text-[#fbbf24]`}>LIVE FLIGHT STATUS · LONDON GATWICK</span>
          {gatwick && (
            <p
              className="m-0 inline-flex items-center gap-[10px] rounded-[16px] bg-ink-2 py-2 pl-[10px] pr-4 sm:rounded-full"
              title={WEATHER_CREDIT}
            >
              <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-[#4a5058]">
                <WeatherIcon kind={gatwick.kind} night={gatwick.night} size={22} onDark />
              </span>
              <span className="flex flex-col leading-tight sm:flex-row sm:items-center sm:gap-[10px]">
                <span className="whitespace-nowrap font-bold text-white">
                  Gatwick now <span className="font-heading text-[20px]">{gatwick.tempC}°</span>
                </span>
                <span className="whitespace-nowrap text-[14px] text-[#c4c9d1] sm:text-[15px]">
                  {gatwick.text} · Wind {gatwick.windMph} mph
                </span>
              </span>
            </p>
          )}
        </div>
        <h1 className="m-0 font-heading text-[clamp(34px,4.6vw,52px)] font-bold leading-[1.03] tracking-[-0.035em] text-white">
          {heading}
        </h1>
        <div className="max-w-[920px]">{children}</div>
      </div>
    </section>
  );
}
