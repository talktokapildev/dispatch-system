"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Search, ClipboardCheck } from "lucide-react";
import { SectionHeader, Table, Spinner, Badge } from "@/components/ui";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
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
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

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
  const summary = data?.summary ?? { PENDING: 0, APPROVED: 0, REJECTED: 0 };

  const filtered = search
    ? applications.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.phone.includes(search) ||
          a.vehicleReg?.toLowerCase().includes(search.toLowerCase()) ||
          a.pcoBadgeNumber?.toLowerCase().includes(search.toLowerCase())
      )
    : applications;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Driver Applications"
        subtitle="Self-onboarding applications awaiting review"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
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
        {/* Status tabs */}
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
            </button>
          ))}
        </div>

        {/* Search */}
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
            ]}
            isEmpty={!filtered.length}
            emptyMessage="No applications found"
          >
            {filtered.map((a: any) => (
              <tr
                key={a.id}
                className="table-row cursor-pointer"
                onClick={() => router.push(`/applications/${a.id}`)}
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
                  <ApplicationStatusBadge status={a.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}

export function ApplicationStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PENDING: {
      label: "Pending",
      className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    },
    APPROVED: {
      label: "Approved",
      className: "bg-green-500/15 text-green-400 border-green-500/20",
    },
    REJECTED: {
      label: "Rejected",
      className: "bg-red-500/15 text-red-400 border-red-500/20",
    },
  };
  const s = map[status] ?? {
    label: status,
    className: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${s.className}`}
    >
      {s.label}
    </span>
  );
}
