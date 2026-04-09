import { clsx } from "clsx";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

// ─── Accent → actual hex (used for inline border + icon bg tints) ───────────
// We can't use dynamic Tailwind class names at runtime so we map explicitly.
const ACCENT_HEX: Record<string, string> = {
  "text-brand-400": "#f59e0b",
  "text-brand-500": "#f59e0b",
  "text-green-400": "#22c55e",
  "text-green-500": "#22c55e",
  "text-blue-400": "#3b82f6",
  "text-blue-500": "#3b82f6",
  "text-red-400": "#ef4444",
  "text-red-500": "#ef4444",
  "text-yellow-400": "#eab308",
  "text-violet-400": "#8b5cf6",
  "text-violet-500": "#8b5cf6",
  "text-indigo-400": "#6366f1",
  "text-indigo-500": "#6366f1",
  "text-cyan-400": "#06b6d4",
  "text-orange-400": "#f97316",
  "text-orange-500": "#f97316",
};

// ─── Badge ───────────────────────────────────────────────────────────────────
export function Badge({
  status,
  label,
  className,
}: {
  status?: string;
  label?: string;
  className?: string;
}) {
  return (
    <span className={clsx("badge", status && `status-${status}`, className)}>
      {label ?? status?.replace(/_/g, " ")}
    </span>
  );
}

export function DriverBadge({ status }: { status: string }) {
  return (
    <span className={clsx("badge", `driver-${status}`)}>
      <span
        className={clsx(
          "status-dot",
          status === "AVAILABLE" && "bg-green-400",
          status === "ON_JOB" && "bg-brand-400",
          status === "BREAK" && "bg-orange-400",
          status === "OFFLINE" && "bg-slate-500"
        )}
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: number;
  accent?: string;
  sub?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  accent = "text-brand-400",
  sub,
}: StatCardProps) {
  const hex = ACCENT_HEX[accent] ?? "#f59e0b";
  const bg12 = hex + "18"; // ~10% opacity tint for icon container
  const borderL = hex; // solid left accent stripe

  return (
    <div className="card p-5" style={{ borderLeft: `3px solid ${borderL}` }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
            {label}
          </p>
          <p className={clsx("text-2xl font-bold mt-1", accent)}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: bg12 }}
        >
          <Icon size={18} className={accent} />
        </div>
      </div>
      {trend !== undefined && (
        <div
          className={clsx(
            "flex items-center gap-1 mt-3 text-xs",
            trend >= 0 ? "text-green-400" : "text-red-400"
          )}
        >
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(trend)}% vs yesterday
        </div>
      )}
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────
export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-lg font-bold text-white">{title}</h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-[var(--table-hover)] flex items-center justify-center mb-3">
        <Icon size={20} className="text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-400">{title}</p>
      {subtitle && <p className="text-xs text-slate-600 mt-1">{subtitle}</p>}
    </div>
  );
}

// ─── Loading spinner ─────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      className="animate-spin text-brand-500"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.2"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────
export function Table({
  headers,
  children,
  isEmpty,
  emptyMessage = "No data",
}: {
  headers: string[];
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left text-xs text-slate-500 font-medium uppercase tracking-wide px-4 py-3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td
                colSpan={headers.length}
                className="text-center py-12 text-slate-500 text-sm"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative card w-full max-w-lg p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Pagination ──────────────────────────────────────────────────────────────
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-sm text-slate-500">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          className="btn-ghost py-1 px-3 disabled:opacity-30"
        >
          Prev
        </button>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          className="btn-ghost py-1 px-3 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}
