"use client";
// admin/src/app/(admin)/compliance/page.tsx
// TfL Compliance Dashboard — live automated checks + manual confirmation checklist.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { SectionHeader, Spinner } from "@/components/ui";
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ClipboardCheck,
  ShieldCheck,
} from "lucide-react";
import toast from "react-hot-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AutomatedCheck {
  id: string;
  condition: number | null;
  title: string;
  status: "PASS" | "WARN" | "FAIL";
  value: string;
  detail: string;
  requirement: string;
  howToFix?: string;
}

interface ManualCheck {
  id: string;
  condition: number | null;
  title: string;
  requirement: string;
  howToConfirm: string;
  confirmedAt?: string;
  confirmedByName?: string;
  notes?: string;
}

interface ComplianceData {
  automated: AutomatedCheck[];
  manual: ManualCheck[];
  summary: {
    autoPass: number;
    autoWarn: number;
    autoFail: number;
    manualConfirmed: number;
    manualUnconfirmed: number;
    totalIssues: number;
  };
  checkedAt: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  if (status === "PASS")
    return <CheckCircle size={size} className="text-green-400 shrink-0" />;
  if (status === "WARN")
    return <AlertTriangle size={size} className="text-yellow-400 shrink-0" />;
  return <XCircle size={size} className="text-red-400 shrink-0" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PASS: "bg-green-500/15 text-green-400 border-green-500/20",
    WARN: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    FAIL: "bg-red-500/15 text-red-400 border-red-500/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${
        map[status] ?? ""
      }`}
    >
      {status}
    </span>
  );
}

// ── Automated check row ────────────────────────────────────────────────────────

function AutomatedRow({
  check,
  expanded,
  onToggle,
}: {
  check: AutomatedCheck;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rowBg =
    check.status === "FAIL"
      ? "border-red-500/20 bg-red-500/5"
      : check.status === "WARN"
      ? "border-yellow-500/20 bg-yellow-500/5"
      : "border-[var(--border)]";

  return (
    <div className={`rounded-lg border ${rowBg} overflow-hidden`}>
      {/* Row header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <StatusIcon status={check.status} />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {check.condition && (
            <span className="text-[10px] text-slate-600 font-mono shrink-0">
              C{check.condition}
            </span>
          )}
          <span
            className="text-xs font-medium truncate"
            style={{ color: "var(--text)" }}
          >
            {check.title}
          </span>
        </div>
        <span
          className={`text-xs font-mono shrink-0 ${
            check.status === "FAIL"
              ? "text-red-400"
              : check.status === "WARN"
              ? "text-yellow-400"
              : "text-green-400"
          }`}
        >
          {check.value}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="text-slate-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-slate-500 shrink-0" />
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-1 space-y-3 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">
              TfL Requirement
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {check.requirement}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">
              What was checked
            </p>
            <p className="text-xs" style={{ color: "var(--text)" }}>
              {check.detail}
            </p>
          </div>
          {check.howToFix && (
            <div
              className={`p-3 rounded-lg text-xs leading-relaxed ${
                check.status === "FAIL"
                  ? "bg-red-950/60 border border-red-500/30"
                  : "bg-yellow-950/60 border border-yellow-500/30"
              }`}
            >
              <span
                className={`font-semibold ${
                  check.status === "FAIL" ? "text-red-400" : "text-yellow-400"
                }`}
              >
                Action required:{" "}
              </span>
              <span style={{ color: "var(--text)" }}>{check.howToFix}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Manual check row ───────────────────────────────────────────────────────────

function ManualRow({
  check,
  expanded,
  onToggle,
  onConfirm,
  isConfirming,
}: {
  check: ManualCheck;
  expanded: boolean;
  onToggle: () => void;
  onConfirm: (key: string, notes?: string) => void;
  isConfirming: boolean;
}) {
  const [notes, setNotes] = useState("");
  const isConfirmed = !!check.confirmedAt;
  const rowBg = isConfirmed
    ? "border-[var(--border)]"
    : "border-yellow-500/20 bg-yellow-500/5";

  return (
    <div className={`rounded-lg border ${rowBg} overflow-hidden`}>
      {/* Row header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        {isConfirmed ? (
          <CheckCircle size={16} className="text-green-400 shrink-0" />
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-yellow-500/50 shrink-0" />
        )}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {check.condition && (
            <span className="text-[10px] text-slate-600 font-mono shrink-0">
              C{check.condition}
            </span>
          )}
          <span
            className="text-xs font-medium truncate"
            style={{ color: "var(--text)" }}
          >
            {check.title}
          </span>
        </div>
        <span className="text-xs shrink-0 text-slate-500">
          {isConfirmed ? "Confirmed" : "Needs review"}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="text-slate-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-slate-500 shrink-0" />
        )}
      </button>

      {/* Expanded */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-1 space-y-3 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">
              TfL Requirement
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {check.requirement}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">
              How to confirm
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {check.howToConfirm}
            </p>
          </div>

          {isConfirmed && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400">
              ✓ Confirmed by {check.confirmedByName ?? "admin"} on{" "}
              {format(new Date(check.confirmedAt!), "dd MMM yyyy 'at' HH:mm")}
              {check.notes && (
                <p className="text-green-300 mt-1">{check.notes}</p>
              )}
            </div>
          )}

          <div className="space-y-2 pt-1">
            <textarea
              className="input w-full resize-none text-xs"
              rows={2}
              placeholder="Optional notes (e.g. insurance policy number, renewal date)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button
              onClick={() => onConfirm(check.id, notes || undefined)}
              disabled={isConfirming}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              {isConfirming ? <Spinner size={12} /> : <CheckCircle size={12} />}
              {isConfirmed ? "Re-confirm" : "Mark as Confirmed"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<ComplianceData>({
    queryKey: ["compliance"],
    queryFn: () => api.get("/admin/compliance").then((r) => r.data),
    refetchInterval: 300_000, // 5 minutes
    staleTime: 60_000,
  });

  const confirmMutation = useMutation({
    mutationFn: ({ key, notes }: { key: string; notes?: string }) =>
      api.post("/admin/compliance/confirm", { key, notes }),
    onSuccess: (_, { key }) => {
      toast.success(
        key === "weekly_upload"
          ? "Weekly TfL upload recorded"
          : "Confirmation saved"
      );
      qc.invalidateQueries({ queryKey: ["compliance"] });
      setConfirmingKey(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? "Failed to save confirmation");
      setConfirmingKey(null);
    },
  });

  const handleConfirm = (key: string, notes?: string) => {
    setConfirmingKey(key);
    confirmMutation.mutate({ key, notes });
  };

  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const summary = data?.summary;

  return (
    <div className="space-y-6 animate-fade-in">
      <SectionHeader
        title="TfL Compliance"
        subtitle={`Licence II786 · Tier 11-20 · ${
          data?.checkedAt
            ? `Last checked ${format(
                new Date(data.checkedAt),
                "HH:mm 'on' dd MMM yyyy"
              )}`
            : "Loading checks…"
        }`}
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Rerun Checks
          </button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner size={28} />
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {
                label: "Passing",
                value: summary?.autoPass ?? 0,
                color: "text-green-400",
                bg: "bg-green-500/10 border-green-500/20",
              },
              {
                label: "Warnings",
                value: summary?.autoWarn ?? 0,
                color: "text-yellow-400",
                bg: "bg-yellow-500/10 border-yellow-500/20",
              },
              {
                label: "Failing",
                value: summary?.autoFail ?? 0,
                color: "text-red-400",
                bg: "bg-red-500/10 border-red-500/20",
              },
              {
                label: "Manual Confirmed",
                value: summary?.manualConfirmed ?? 0,
                color: "text-green-400",
                bg: "bg-green-500/10 border-green-500/20",
              },
              {
                label: "Needs Review",
                value: summary?.manualUnconfirmed ?? 0,
                color: "text-yellow-400",
                bg: "bg-yellow-500/10 border-yellow-500/20",
              },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`card p-4 border ${bg}`}>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                  {label}
                </p>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Overall status banner */}
          {(summary?.totalIssues ?? 0) === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <ShieldCheck size={20} className="text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-400">
                  All systems compliant
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  All automated checks passing and manual items confirmed.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle size={20} className="text-yellow-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-yellow-400">
                  {summary?.totalIssues} item
                  {summary?.totalIssues !== 1 ? "s" : ""} need attention
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review the items below and take action where required.
                </p>
              </div>
            </div>
          )}

          {/* Automated checks */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={14} className="text-brand-400" />
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--text)" }}
              >
                Automated Checks ({data?.automated.length ?? 0})
              </h2>
              <span className="text-[10px] text-slate-600">
                · Run against live database
              </span>
            </div>
            <div className="space-y-2">
              {data?.automated.map((check) => (
                <AutomatedRow
                  key={check.id}
                  check={check}
                  expanded={expandedId === check.id}
                  onToggle={() => toggle(check.id)}
                />
              ))}
            </div>
          </div>

          {/* Manual checklist */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={14} className="text-slate-400" />
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--text)" }}
              >
                Manual Checklist ({data?.manual.length ?? 0})
              </h2>
              <span className="text-[10px] text-slate-600">
                · Requires your confirmation
              </span>
            </div>
            <div className="space-y-2">
              {data?.manual.map((check) => (
                <ManualRow
                  key={check.id}
                  check={check}
                  expanded={expandedId === check.id}
                  onToggle={() => toggle(check.id)}
                  onConfirm={handleConfirm}
                  isConfirming={
                    confirmingKey === check.id && confirmMutation.isPending
                  }
                />
              ))}
            </div>

            {/* Weekly upload — special confirm button */}
            <div className="card p-4 border border-[var(--border)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p
                    className="text-xs font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    Weekly TfL Upload — Mark as Completed
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    After uploading driver + vehicle reports to
                    tfl.gov.uk/ph-operators, click to record completion. This
                    resets the 7-day automated check.
                  </p>
                </div>
                <button
                  onClick={() => handleConfirm("weekly_upload")}
                  disabled={
                    confirmMutation.isPending &&
                    confirmingKey === "weekly_upload"
                  }
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-black text-xs font-semibold transition-colors shrink-0"
                >
                  {confirmMutation.isPending &&
                  confirmingKey === "weekly_upload" ? (
                    <Spinner size={12} />
                  ) : (
                    <CheckCircle size={12} />
                  )}
                  Mark as Uploaded
                </button>
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
            <strong>Note:</strong> Automated checks run against live database
            records. Manual confirmations record that you have verified a
            condition offline. This dashboard does not constitute legal advice —
            always refer to TfL&apos;s official guidance at{" "}
            <a
              href="https://tfl.gov.uk/info-for/taxis-and-private-hire"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-200"
            >
              tfl.gov.uk/info-for/taxis-and-private-hire
            </a>
            .
          </div>
        </>
      )}
    </div>
  );
}
