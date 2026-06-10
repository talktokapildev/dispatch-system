"use client";
// admin/src/app/(admin)/settings/WalletSection.tsx

import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  Gift,
  TrendingUp,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface WalletConfig {
  walletWelcomeBonus: number;
  walletMonthlyPromoCap: number;
  walletBonusExpiryDays: number;
}

interface MonthlyStats {
  issuedThisMonth: number;
  capRemaining: number;
  capPercent: number;
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  integer?: boolean;
}) {
  return (
    <div>
      <label
        className="text-xs font-medium block mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        {prefix && (
          <span
            className="text-sm font-medium px-2.5 py-2 rounded-lg border"
            style={{
              background: "var(--table-hover)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
          >
            {prefix}
          </span>
        )}
        <input
          type="number"
          step={integer ? "1" : "0.01"}
          min="0"
          value={value}
          onChange={(e) =>
            onChange(
              integer
                ? parseInt(e.target.value) || 0
                : parseFloat(e.target.value) || 0
            )
          }
          className="input"
          style={{ maxWidth: 120 }}
        />
        {suffix && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ─── Group header ─────────────────────────────────────────────────────────────
function GroupHeader({
  icon: Icon,
  label,
  color = "text-brand-400",
}: {
  icon: any;
  label: string;
  color?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 mb-4 pb-2 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <Icon size={14} className={color} />
      <h3
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </h3>
    </div>
  );
}

// ─── Monthly cap progress bar ─────────────────────────────────────────────────
function CapProgress({ stats }: { stats: MonthlyStats }) {
  const pct = Math.min(stats.capPercent, 100);
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-brand-500";

  return (
    <div
      className="p-4 rounded-xl border space-y-3"
      style={{ borderColor: "var(--border)", background: "var(--table-hover)" }}
    >
      <div className="flex justify-between items-center">
        <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
          Monthly promo cap usage
        </span>
        <span
          className="text-xs font-bold"
          style={{ color: pct >= 90 ? "var(--danger)" : "var(--text)" }}
        >
          {pct.toFixed(0)}%
        </span>
      </div>
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: "var(--border)" }}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className="flex justify-between text-[11px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span>£{stats.issuedThisMonth.toFixed(2)} issued this month</span>
        <span>£{stats.capRemaining.toFixed(2)} remaining</span>
      </div>
      {pct >= 90 && (
        <div className="flex items-center gap-1.5 text-[11px] text-yellow-400">
          <AlertTriangle size={11} />
          Monthly cap nearly reached — new users won't receive welcome bonus
        </div>
      )}
    </div>
  );
}

// ─── Wallet Section ───────────────────────────────────────────────────────────
export function WalletSection() {
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/pricing/config");
      setConfig({
        walletWelcomeBonus: data.data.walletWelcomeBonus ?? 25,
        walletMonthlyPromoCap: data.data.walletMonthlyPromoCap ?? 1000,
        walletBonusExpiryDays: data.data.walletBonusExpiryDays ?? 90,
      });
    } catch {
      toast.error("Failed to load wallet config");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/wallet/monthly-stats");
      setStats(data.data);
    } catch {
      // Stats are non-critical — fail silently
    }
  }, []);

  useEffect(() => {
    load();
    loadStats();
  }, [load, loadStats]);

  const update = (key: keyof WalletConfig, value: number) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.put("/pricing/config", config);
      toast.success("Wallet settings saved");
      setDirty(false);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner size={24} />
      </div>
    );

  if (!config)
    return <div className="text-sm text-red-400">Failed to load config</div>;

  return (
    <div className="space-y-4">
      {/* Header with save */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Wallet Configuration
        </h2>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-brand-400">Unsaved changes</span>
          )}
          <button
            onClick={load}
            className="btn-ghost py-1.5 px-3 flex items-center gap-1.5 text-xs"
          >
            <RefreshCw size={12} /> Reload
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Spinner size={14} /> : <CheckCircle size={14} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-6">
        {/* Welcome Bonus */}
        <div>
          <GroupHeader
            icon={Gift}
            label="Welcome Bonus"
            color="text-brand-400"
          />
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Field
              label="Welcome bonus amount"
              value={config.walletWelcomeBonus}
              onChange={(v) => update("walletWelcomeBonus", v)}
              prefix="£"
              hint="Credited after passenger's first completed trip"
            />
            <Field
              label="Bonus expiry"
              value={config.walletBonusExpiryDays}
              onChange={(v) => update("walletBonusExpiryDays", v)}
              suffix="days"
              hint="Days from issue date before credit expires"
              integer
            />
          </div>
        </div>

        {/* Monthly Cap */}
        <div>
          <GroupHeader
            icon={TrendingUp}
            label="Monthly Promo Cap"
            color="text-yellow-400"
          />
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Field
              label="Monthly cap"
              value={config.walletMonthlyPromoCap}
              onChange={(v) => update("walletMonthlyPromoCap", v)}
              prefix="£"
              hint="Maximum total promo credits issued per calendar month"
            />
          </div>

          {/* Live cap progress */}
          {stats && (
            <div className="mt-4">
              <CapProgress stats={stats} />
            </div>
          )}
        </div>

        {/* Info box */}
        <div
          className="p-4 rounded-xl border text-xs space-y-1.5"
          style={{
            borderColor: "var(--border)",
            background: "var(--table-hover)",
            color: "var(--text-muted)",
          }}
        >
          <p
            className="flex items-center gap-1.5 font-medium"
            style={{ color: "var(--text)" }}
          >
            <Wallet size={12} /> How the wallet works
          </p>
          <p>• Promotional credits only — no real money top-up at this stage</p>
          <p>
            • Welcome bonus unlocks after passenger completes their first trip
          </p>
          <p>
            • Wallet covers full fare only — if fare exceeds balance, passenger
            pays by card
          </p>
          <p>
            • Corporate and care home account bookings are excluded from wallet
          </p>
          <p>• Credits expire after the configured number of days from issue</p>
        </div>
      </div>
    </div>
  );
}
