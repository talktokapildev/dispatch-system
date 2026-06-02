"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Search, Trash2, AlertTriangle } from "lucide-react";
import { SectionHeader, Table, Spinner, Modal } from "@/components/ui";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ARCHIVED", label: "Archived" },
];

function DocProgress({ uploaded, total }: { uploaded: number; total: number }) {
  const pct = Math.round((uploaded / total) * 100);
  const color =
    uploaded === total
      ? "bg-green-500"
      : uploaded === 0
      ? "bg-slate-700"
      : "bg-brand-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 tabular-nums">
        {uploaded}/{total}
      </span>
    </div>
  );
}

export default function ApplicationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  // Archive (soft delete) state
  const [archiveTarget, setArchiveTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // Hard delete state
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirmError, setConfirmError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["driver-applications", statusFilter],
    queryFn: () =>
      api
        .get("/admin/driver-applications", {
          params: { ...(statusFilter && { status: statusFilter }) },
        })
        .then((r) => r.data),
    refetchInterval: 30_000,
  });

  const applications: any[] = data?.applications ?? [];
  const summary = data?.summary ?? {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    ARCHIVED: 0,
  };

  const filtered = search
    ? applications.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.phone.includes(search) ||
          a.vehicleReg?.toLowerCase().includes(search.toLowerCase()) ||
          a.pcoBadgeNumber?.toLowerCase().includes(search.toLowerCase())
      )
    : applications;

  // ── Archive mutation ──────────────────────────────────────────────────────
  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/driver-applications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver-applications"] });
      setArchiveTarget(null);
    },
    onError: (err: any) => alert(err.response?.data?.error ?? "Archive failed"),
  });

  // ── Hard delete mutation ──────────────────────────────────────────────────
  const hardDeleteMutation = useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      api.delete(`/admin/driver-applications/${id}/permanent`, {
        data: { confirmName },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver-applications"] });
      setDeleteTarget(null);
      setConfirmName("");
      setConfirmError("");
    },
    onError: (err: any) =>
      setConfirmError(err.response?.data?.error ?? "Delete failed"),
  });

  const handleHardDelete = () => {
    setConfirmError("");
    if (!deleteTarget) return;
    if (
      confirmName.trim().toLowerCase() !==
      deleteTarget.name.trim().toLowerCase()
    ) {
      setConfirmError(
        `Name doesn't match. Type exactly: "${deleteTarget.name}"`
      );
      return;
    }
    hardDeleteMutation.mutate({
      id: deleteTarget.id,
      confirmName: confirmName.trim(),
    });
  };

  const isArchivedTab = statusFilter === "ARCHIVED";

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Driver Applications"
        subtitle="Self-onboarding applications awaiting review"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: "Pending Review",
            count: summary.PENDING,
            color: "text-yellow-400",
            bg: "bg-yellow-500/10 border-yellow-500/20",
          },
          {
            label: "Approved",
            count: summary.APPROVED,
            color: "text-green-400",
            bg: "bg-green-500/10 border-green-500/20",
          },
          {
            label: "Rejected",
            count: summary.REJECTED,
            color: "text-red-400",
            bg: "bg-red-500/10 border-red-500/20",
          },
          {
            label: "Archived",
            count: summary.ARCHIVED,
            color: "text-slate-400",
            bg: "bg-slate-500/10 border-slate-500/20",
          },
        ].map(({ label, count, color, bg }) => (
          <div key={label} className={`card p-4 border ${bg}`}>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
              {label}
            </p>
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? "bg-brand-500 text-black"
                  : "text-slate-400 hover:text-white bg-transparent"
              }`}
            >
              {tab.label}
              {tab.value === "PENDING" && summary.PENDING > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px]">
                  {summary.PENDING}
                </span>
              )}
              {tab.value === "ARCHIVED" && summary.ARCHIVED > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-500/20 text-slate-400 text-[10px]">
                  {summary.ARCHIVED}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-9"
            placeholder="Search name, phone, reg, PCO badge…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Applicant",
              "Phone",
              "Vehicle",
              "PCO Badge",
              "Documents",
              "Submitted",
              "Status",
              "",
            ]}
            isEmpty={!filtered.length}
            emptyMessage={
              isArchivedTab
                ? "No archived applications"
                : "No applications found"
            }
          >
            {filtered.map((a: any) => {
              const isArchived = !!a.deletedAt;
              return (
                <tr
                  key={a.id}
                  className={`table-row ${
                    isArchived ? "opacity-50" : "cursor-pointer"
                  }`}
                  onClick={() =>
                    !isArchived && router.push(`/applications/${a.id}`)
                  }
                >
                  {/* Applicant */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-bold shrink-0">
                        {a.name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {a.name}
                      </p>
                    </div>
                  </td>

                  {/* Phone */}
                  <td className="px-4 py-3 text-xs font-mono text-slate-400">
                    {a.phone}
                  </td>

                  {/* Vehicle */}
                  <td className="px-4 py-3">
                    <p className="text-xs" style={{ color: "var(--text)" }}>
                      {a.vehicleMake} {a.vehicleModel}
                    </p>
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {a.vehicleReg}
                    </p>
                  </td>

                  {/* PCO Badge */}
                  <td className="px-4 py-3 text-xs font-mono text-slate-400">
                    {a.pcoBadgeNumber}
                  </td>

                  {/* Documents */}
                  <td className="px-4 py-3 min-w-[100px]">
                    <DocProgress
                      uploaded={a.documentsUploaded}
                      total={a.documentsTotal}
                    />
                  </td>

                  {/* Submitted */}
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {format(new Date(a.createdAt), "dd MMM yyyy")}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {isArchived ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400">
                        ARCHIVED
                      </span>
                    ) : (
                      <ApplicationStatusBadge status={a.status} />
                    )}
                  </td>

                  {/* Actions */}
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isArchived ? (
                      // Hard delete — only available on archived rows
                      <button
                        onClick={() => {
                          setDeleteTarget({ id: a.id, name: a.name });
                          setConfirmName("");
                          setConfirmError("");
                        }}
                        className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors border border-red-500/20 rounded px-2 py-1 hover:bg-red-500/10"
                        title="Permanently delete"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    ) : (
                      // Soft delete — available on all non-archived rows
                      <button
                        onClick={() =>
                          setArchiveTarget({ id: a.id, name: a.name })
                        }
                        className="p-1.5 rounded text-slate-600 hover:text-slate-400 hover:bg-slate-700/40 transition-colors"
                        title="Archive application"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {/* ── Archive confirmation modal ── */}
      <Modal
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        title="Archive Application"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle
              size={16}
              className="text-yellow-400 shrink-0 mt-0.5"
            />
            <div className="text-xs text-yellow-300 space-y-1">
              <p className="font-semibold">
                This will archive {archiveTarget?.name}'s application.
              </p>
              <p className="text-yellow-400/80">
                If their account was approved, their driver account will also be
                suspended — they will no longer be able to log in or receive
                jobs. All data is preserved and can be permanently deleted
                later.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setArchiveTarget(null)}
              className="flex-1 btn-ghost py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                archiveTarget && archiveMutation.mutate(archiveTarget.id)
              }
              disabled={archiveMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {archiveMutation.isPending ? (
                <Spinner size={14} />
              ) : (
                <Trash2 size={14} />
              )}
              Archive
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Permanently delete confirmation modal ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
          setConfirmName("");
          setConfirmError("");
        }}
        title="Permanently Delete"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-300 space-y-1">
              <p className="font-semibold">This action cannot be undone.</p>
              <p className="text-red-400/80">
                All data for {deleteTarget?.name} will be permanently deleted —
                application, driver account, vehicle, and documents. Completed
                booking history will be preserved.
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              Type{" "}
              <span className="text-white font-mono">{deleteTarget?.name}</span>{" "}
              to confirm
            </label>
            <input
              className="input w-full"
              placeholder={deleteTarget?.name}
              value={confirmName}
              onChange={(e) => {
                setConfirmName(e.target.value);
                setConfirmError("");
              }}
              autoFocus
            />
          </div>

          {confirmError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {confirmError}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => {
                setDeleteTarget(null);
                setConfirmName("");
                setConfirmError("");
              }}
              className="flex-1 btn-ghost py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleHardDelete}
              disabled={hardDeleteMutation.isPending || !confirmName.trim()}
              className="flex-1 btn-danger flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-50"
            >
              {hardDeleteMutation.isPending ? (
                <Spinner size={14} />
              ) : (
                <Trash2 size={14} />
              )}
              Permanently Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
