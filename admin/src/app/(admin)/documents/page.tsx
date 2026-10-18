"use client";
// Documents: driver & vehicle documents across the fleet.
// Tabs: waiting for review, expiring (30 days), expired, approved without an expiry date,
// rejected, and every approved version in force. Review = approve with expiry date / reject with
// a reason (the driver is notified). Per-driver and per-car views are on the Drivers / Vehicles pages.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CarFront, FileText, User } from "lucide-react";
import { api } from "@/lib/api";
import { SectionHeader, Spinner, Table } from "@/components/ui";
import { DOC_LABELS, ExpiryText, ReviewModal, StateChip } from "@/components/Documents";

const TABS = [
  { key: "pending", label: "Waiting for review", count: "pending", badge: "bg-red-500 text-white" },
  { key: "expiring", label: "Expiring (30 days)", count: "expiring", badge: "bg-yellow-500 text-black" },
  { key: "expired", label: "Expired", count: "expired", badge: "bg-red-500 text-white" },
  { key: "expiry_needed", label: "No expiry date", count: "expiryNeeded", badge: "bg-orange-500 text-black" },
  { key: "rejected", label: "Rejected", count: null, badge: "" },
  { key: "current", label: "All approved", count: null, badge: "" },
] as const;

export default function DocumentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const [selected, setSelected] = useState<any>(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["docs", tab],
    queryFn: () => api.get("/admin/documents", { params: { view: tab, days: 30 } }).then((r) => r.data.data),
    refetchInterval: 30_000,
  });
  const { data: counts } = useQuery({
    queryKey: ["docs-counts"],
    queryFn: () => api.get("/admin/documents/counts").then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const showExpiry = tab !== "rejected";
  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Documents"
        subtitle="Driver documents (PCO badge, licence, DBS) and vehicle documents (PHV licence, insurance, MOT, V5C). A driver gets jobs only when all are approved and in date."
      />

      <div className="flex flex-wrap gap-1 p-1 bg-[var(--table-hover)] rounded-lg border border-[var(--border)] w-fit">
        {TABS.map((t) => {
          const n = t.count ? counts?.[t.count] ?? 0 : 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                tab === t.key ? "bg-brand-500 text-black" : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
              {n > 0 && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${t.badge}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={["Belongs to", "Document", "Uploaded", ...(showExpiry ? ["Expiry"] : ["Reason"]), "Status", ""]}
            isEmpty={!docs.length}
            emptyMessage="Nothing here"
          >
            {docs.map((doc: any) => (
              <tr key={doc.id} className="table-row cursor-pointer" onClick={() => setSelected(doc)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {doc.owner.kind === "vehicle" ? (
                      <CarFront size={13} className="text-slate-500" />
                    ) : (
                      <User size={13} className="text-slate-500" />
                    )}
                    <div>
                      <p className="text-xs text-[var(--text)]">
                        {doc.owner.kind === "vehicle" ? (
                          <span className="font-mono">{doc.owner.licensePlate}</span>
                        ) : (
                          doc.owner.driverName
                        )}
                      </p>
                      {doc.owner.kind === "vehicle" && (
                        <p className="text-[10px] text-slate-500">{doc.owner.driverName ?? "Unassigned"}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="text-slate-500" />
                    <span className="text-xs text-slate-300">{DOC_LABELS[doc.type] ?? doc.type}</span>
                    {doc.pages?.length > 1 && <span className="text-[10px] text-slate-500">({doc.pages.length} pages)</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{format(new Date(doc.createdAt), "dd MMM yyyy")}</td>
                {showExpiry ? (
                  <td className="px-4 py-3">
                    {doc.expiryDate ? (
                      <ExpiryText date={doc.expiryDate} daysLeft={doc.daysLeft} />
                    ) : doc.expiryRequired ? (
                      <span className="text-xs text-orange-400">needed</span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                ) : (
                  <td className="px-4 py-3 text-xs text-red-400 max-w-[240px] truncate">{doc.rejectionReason ?? "—"}</td>
                )}
                <td className="px-4 py-3">
                  <StateChip state={doc.status} />
                </td>
                <td className="px-4 py-3 text-xs text-brand-400">
                  {doc.status === "PENDING" ? "Review →" : doc.status === "APPROVED" && !doc.expiryDate && doc.expiryRequired ? "Add date →" : "View →"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <ReviewModal doc={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
