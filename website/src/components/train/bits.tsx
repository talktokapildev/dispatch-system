import Link from "next/link";
import { StatusPill } from "@/components/flight/ui";
import { WHATSAPP_HREF } from "@/lib/site";
import { operatorName, operatorStyle, statusText, StopTime, toneFor, TrainService } from "@/lib/trainFormat";

// Small shared pieces for the train times pages.

/** Train company label ("Southern", "Thameslink"…), or "Bus" for a replacement bus. */
export function OperatorTag({ s, size = "md" }: { s: TrainService; size?: "sm" | "md" | "lg" }) {
  const c = s.kind === "BUS" ? { bg: "#2e3238", fg: "#fbbf24" } : operatorStyle(s.operatorCode);
  const cls =
    size === "lg"
      ? "rounded-[9px] px-3 py-[6px] text-[15px]"
      : size === "sm"
        ? "rounded-[6px] px-[7px] py-[2px] text-[11.5px]"
        : "rounded-[7px] px-[9px] py-1 text-[13px]";
  return (
    <span
      className={`inline-block whitespace-nowrap font-extrabold leading-tight tracking-[0.01em] ${cls}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {s.kind === "BUS" ? `Bus${s.operator ? ` · ${s.operator}` : ""}` : operatorName(s)}
    </span>
  );
}

export function TrainStatus({ t, cancelled, small = true }: { t: StopTime; cancelled: boolean; small?: boolean }) {
  return (
    <StatusPill tone={toneFor(t, cancelled)} small={small}>
      {statusText(t, cancelled)}
    </StatusPill>
  );
}

/** Platform number in a dark tile, like a station sign. */
export function PlatformTile({ platform, size = "md" }: { platform: string | null; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "min-w-[52px] h-[52px] text-[28px] rounded-[12px]" : "min-w-[38px] h-[38px] text-[19px] rounded-[10px]";
  if (!platform) return <span className="text-muted">–</span>;
  return (
    <span className={`inline-grid place-items-center bg-ink px-2 font-heading font-bold text-[#fbbf24] ${dims}`} title={`Platform ${platform}`}>
      {platform}
    </span>
  );
}

/** The dark "book a pickup" panel. */
export function StationBookPanel({ stationName, compact = false }: { stationName: string; compact?: boolean }) {
  return (
    <section
      className={`grid gap-6 rounded-[28px] bg-ink px-6 py-8 text-[#d1d5db] ${
        compact ? "sm:px-8" : "sm:px-10 sm:py-10 md:grid-cols-[1.4fr_1fr] md:items-center"
      }`}
    >
      <div className="flex flex-col gap-3">
        <span className="text-[13px] font-extrabold tracking-[0.08em] text-[#fbbf24]">ARRIVING BY TRAIN?</span>
        <h2 className="m-0 font-heading text-[clamp(26px,3vw,34px)] leading-[1.08] tracking-[-0.02em] text-white">
          Book a pickup from {stationName}.
        </h2>
        <p className="m-0 text-[16.5px]">
          Pre-booked, fixed fare, licensed driver. Book at least 24 hours ahead and tell us which train you&apos;re on.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Link
          href="/#quote"
          className="flex min-h-[54px] items-center justify-center rounded-[14px] bg-amber px-5 text-[17px] font-extrabold text-ink no-underline hover:bg-[#fbbf24] hover:text-ink"
        >
          Get a fixed price
        </Link>
        <a href={WHATSAPP_HREF} className="py-2 text-center text-[15px] font-bold text-[#fbbf24] hover:text-[#fde68a]">
          Or book on WhatsApp
        </a>
      </div>
    </section>
  );
}
