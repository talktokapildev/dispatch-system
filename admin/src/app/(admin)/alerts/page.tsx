"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { format } from "date-fns";
import {
  AlertTriangle,
  Clock,
  FileText,
  CheckCircle,
  MessageSquareWarning,
  ChevronDown,
  ChevronUp,
  X,
  Package,
} from "lucide-react";
import { SectionHeader, Spinner } from "@/components/ui";
import { useState } from "react";

const LOST_PROPERTY_STATUSES = ["REPORTED", "FOUND", "RETURNED", "CLOSED"];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REPORTED: { label: "Reported", color: "text-amber-400" },
  FOUND: { label: "Found", color: "text-blue-400" },
  RETURNED: { label: "Returned", color: "text-green-400" },
  CLOSED: { label: "Closed", color: "text-slate-500" },
};

export default function AlertsPage() {
  const qc = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const [resolving, setResolving] = useState<any>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [showClosedLost, setShowClosedLost] = useState(false);
  const [updatingLost, setUpdatingLost] = useState<any>(null);
  const [lostStatus, setLostStatus] = useState("");
  const [lostNotes, setLostNotes] = useState("");

  const { data: complaints, isLoading: loadingComplaints } = useQuery({
    queryKey: ["complaints"],
    queryFn: () => api.get("/admin/complaints").then((r) => r.data.data),
  });

  const { data: lostProperties, isLoading: loadingLost } = useQuery({
    queryKey: ["lost-property"],
    queryFn: () => api.get("/admin/lost-property").then((r) => r.data.data),
  });

  const { data: expiring30, isLoading: l1 } = useQuery({
    queryKey: ["expiring", 30],
    queryFn: () =>
      api
        .get("/admin/drivers/documents/expiring", { params: { days: 30 } })
        .then((r) => r.data.data),
  });

  const { data: expiring60 } = useQuery({
    queryKey: ["expiring", 60],
    queryFn: () =>
      api
        .get("/admin/drivers/documents/expiring", { params: { days: 60 } })
        .then((r) => r.data.data),
  });

  const { data: pendingDocs } = useQuery({
    queryKey: ["docs", "PENDING"],
    queryFn: () =>
      api
        .get("/admin/drivers", { params: { limit: 100 } })
        .then((r) =>
          r.data.data.flatMap((d: any) =>
            (d.documents ?? [])
              .filter((doc: any) => doc.status === "PENDING")
              .map((doc: any) => ({ ...doc, driver: d }))
          )
        ),
  });

  const acknowledgeMutation = useMutation({
    mutationFn: ({ bookingId, note }: { bookingId: string; note: string }) =>
      api.patch(`/admin/complaints/${bookingId}/acknowledge`, {
        resolutionNote: note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["complaints"] });
      setResolving(null);
      setResolutionNote("");
    },
  });

  const updateLostMutation = useMutation({
    mutationFn: ({
      id,
      status,
      adminNotes,
    }: {
      id: string;
      status: string;
      adminNotes: string;
    }) => api.patch(`/admin/lost-property/${id}`, { status, adminNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lost-property"] });
      setUpdatingLost(null);
      setLostStatus("");
      setLostNotes("");
    },
  });

  const daysUntil = (date: string) =>
    Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);

  const critical = (expiring30 ?? []).filter(
    (d: any) => daysUntil(d.expiryDate) <= 7
  );
  const warning = (expiring30 ?? []).filter((d: any) => {
    const days = daysUntil(d.expiryDate);
    return days > 7 && days <= 30;
  });
  const upcoming = (expiring60 ?? []).filter(
    (d: any) => daysUntil(d.expiryDate) > 30
  );

  const unresolvedComplaints = (complaints ?? []).filter(
    (c: any) => !c.acknowledged
  );
  const resolvedComplaints = (complaints ?? []).filter(
    (c: any) => c.acknowledged
  );

  const openLost = (lostProperties ?? []).filter(
    (l: any) => !["RETURNED", "CLOSED"].includes(l.status)
  );
  const closedLost = (lostProperties ?? []).filter((l: any) =>
    ["RETURNED", "CLOSED"].includes(l.status)
  );

  const totalAlerts =
    (critical?.length ?? 0) +
    (warning?.length ?? 0) +
    (pendingDocs?.length ?? 0) +
    unresolvedComplaints.length +
    openLost.length;

  const parseComplaint = (feedback: string) => {
    const lines = (feedback ?? "").replace("[COMPLAINT] ", "").split("\n");
    const category = lines[0]?.replace("Category: ", "") ?? "";
    const description = lines.slice(1).join("\n").trim();
    return { category, description };
  };

  const parseResolutionNote = (operatorNotes: string | null) => {
    if (!operatorNotes) return null;
    const match = operatorNotes.match(/\[ACK\][^\n]*Note: ([^\n]+)/);
    return match ? match[1].trim() : null;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Alerts & Compliance"
        subtitle={
          totalAlerts > 0 ? `${totalAlerts} items need attention` : "All clear"
        }
      />

      {totalAlerts === 0 &&
        !l1 &&
        !loadingComplaints &&
        !loadingLost &&
        resolvedComplaints.length === 0 &&
        closedLost.length === 0 && (
          <div className="card p-12 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center mb-3">
              <CheckCircle size={20} className="text-green-400" />
            </div>
            <p className="text-sm font-medium text-white">All clear</p>
            <p className="text-xs text-slate-500 mt-1">
              No complaints, lost property, expiring documents or pending
              reviews
            </p>
          </div>
        )}

      {/* ── Lost Property (TfL Condition 9) ── */}
      {!loadingLost && (openLost.length > 0 || closedLost.length > 0) && (
        <div className="card border-blue-500/20">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
            <Package size={14} className="text-blue-400" />
            <p className="text-sm font-semibold text-white">
              Lost Property
              {openLost.length > 0 && (
                <span className="ml-1.5 text-amber-400">
                  ({openLost.length} open)
                </span>
              )}
              {openLost.length === 0 && (
                <span className="ml-1.5 text-green-400">(all resolved)</span>
              )}
            </p>
            <span className="ml-auto text-[10px] text-slate-500">
              TfL Condition 9
            </span>
          </div>

          {openLost.length === 0 && (
            <div className="px-4 py-4 text-xs text-slate-500 text-center">
              No open reports
            </div>
          )}

          <div className="divide-y divide-[#1e2d42]">
            {openLost.map((l: any) => (
              <div key={l.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs font-semibold ${
                          STATUS_LABELS[l.status]?.color
                        }`}
                      >
                        {STATUS_LABELS[l.status]?.label}
                      </span>
                      <span className="text-[10px] font-mono text-brand-400">
                        {l.booking?.reference}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {format(new Date(l.reportedAt), "dd MMM yyyy HH:mm")}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {l.passenger?.user?.firstName}{" "}
                      {l.passenger?.user?.lastName}
                      {" · "}
                      <span className="text-slate-500">{l.contactPhone}</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {l.description}
                    </p>
                    {l.adminNotes && (
                      <p className="text-xs text-blue-400 mt-1">
                        Note: {l.adminNotes}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setUpdatingLost(l);
                      setLostStatus(l.status);
                      setLostNotes(l.adminNotes ?? "");
                    }}
                    className="shrink-0 text-[10px] text-slate-400 hover:text-blue-400 border border-[var(--border)] hover:border-blue-500/40 rounded px-2 py-1 transition-colors whitespace-nowrap"
                  >
                    Update
                  </button>
                </div>
              </div>
            ))}
          </div>

          {closedLost.length > 0 && (
            <>
              <button
                onClick={() => setShowClosedLost(!showClosedLost)}
                className="w-full flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <span>
                  {closedLost.length} resolved report
                  {closedLost.length > 1 ? "s" : ""}
                </span>
                {showClosedLost ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>
              {showClosedLost && (
                <div className="divide-y divide-[#1e2d42]">
                  {closedLost.map((l: any) => (
                    <div key={l.id} className="px-4 py-3 opacity-60">
                      <div className="flex items-start gap-3">
                        <CheckCircle
                          size={12}
                          className="text-green-400 mt-0.5 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-xs font-semibold ${
                                STATUS_LABELS[l.status]?.color
                              }`}
                            >
                              {STATUS_LABELS[l.status]?.label}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">
                              {l.booking?.reference}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {l.passenger?.user?.firstName}{" "}
                            {l.passenger?.user?.lastName}
                          </p>
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                            {l.description}
                          </p>
                          {l.adminNotes && (
                            <p className="text-xs text-slate-600 mt-0.5">
                              Note: {l.adminNotes}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Passenger Complaints (TfL Condition 7) ── */}
      {loadingComplaints ? (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      ) : (
        (unresolvedComplaints.length > 0 || resolvedComplaints.length > 0) && (
          <div className="card border-orange-500/20">
            <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
              <MessageSquareWarning size={14} className="text-orange-400" />
              <p className="text-sm font-semibold text-white">
                Passenger Complaints
                {unresolvedComplaints.length > 0 && (
                  <span className="ml-1.5 text-orange-400">
                    ({unresolvedComplaints.length} open)
                  </span>
                )}
                {unresolvedComplaints.length === 0 && (
                  <span className="ml-1.5 text-green-400">(all resolved)</span>
                )}
              </p>
              <span className="ml-auto text-[10px] text-slate-500">
                TfL Condition 7
              </span>
            </div>

            {unresolvedComplaints.length === 0 && (
              <div className="px-4 py-4 text-xs text-slate-500 text-center">
                No open complaints
              </div>
            )}

            <div className="divide-y divide-[#1e2d42]">
              {unresolvedComplaints.map((c: any) => {
                const { category, description } = parseComplaint(c.feedback);
                return (
                  <div key={c.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-orange-400">
                            {category}
                          </span>
                          <span className="text-[10px] font-mono text-brand-400">
                            {c.reference}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {format(new Date(c.updatedAt), "dd MMM yyyy HH:mm")}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">
                          {c.passenger?.user?.firstName}{" "}
                          {c.passenger?.user?.lastName}
                          {" · "}
                          <span className="text-slate-500">
                            {c.passenger?.user?.phone}
                          </span>
                        </p>
                        {description && (
                          <p className="text-xs text-slate-400 mt-1">
                            {description}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setResolving(c);
                          setResolutionNote("");
                        }}
                        className="shrink-0 text-[10px] text-slate-400 hover:text-green-400 border border-[var(--border)] hover:border-green-500/40 rounded px-2 py-1 transition-colors whitespace-nowrap"
                      >
                        ✓ Resolve
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {resolvedComplaints.length > 0 && (
              <>
                <button
                  onClick={() => setShowResolved(!showResolved)}
                  className="w-full flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <span>
                    {resolvedComplaints.length} resolved complaint
                    {resolvedComplaints.length > 1 ? "s" : ""}
                  </span>
                  {showResolved ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
                {showResolved && (
                  <div className="divide-y divide-[#1e2d42]">
                    {resolvedComplaints.map((c: any) => {
                      const { category, description } = parseComplaint(
                        c.feedback
                      );
                      const note = parseResolutionNote(c.operatorNotes);
                      return (
                        <div key={c.id} className="px-4 py-3 opacity-70">
                          <div className="flex items-start gap-3">
                            <CheckCircle
                              size={12}
                              className="text-green-400 mt-0.5 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-slate-400">
                                  {category}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500">
                                  {c.reference}
                                </span>
                                <span className="text-[10px] text-slate-600">
                                  {format(new Date(c.updatedAt), "dd MMM yyyy")}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {c.passenger?.user?.firstName}{" "}
                                {c.passenger?.user?.lastName}
                              </p>
                              {description && (
                                <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                                  {description}
                                </p>
                              )}
                              {note && (
                                <p className="text-xs text-green-600 mt-1">
                                  ✓ Resolution: {note}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )
      )}

      {/* Critical */}
      {critical?.length > 0 && (
        <AlertSection
          icon={AlertTriangle}
          title="Critical — Expiring within 7 days"
          colour="red"
          items={critical}
          daysUntil={daysUntil}
        />
      )}

      {/* Pending review */}
      {pendingDocs?.length > 0 && (
        <div className="card border-yellow-500/20">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
            <FileText size={14} className="text-yellow-400" />
            <p className="text-sm font-semibold text-white">
              Pending Document Review ({pendingDocs.length})
            </p>
          </div>
          <div className="divide-y divide-[#1e2d42]">
            {pendingDocs.map((doc: any) => (
              <div
                key={doc.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-xs text-[var(--text)] font-medium">
                    {doc.driver?.user?.firstName} {doc.driver?.user?.lastName}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {doc.type?.replace(/_/g, " ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-600">
                    Uploaded{" "}
                    {doc.createdAt && format(new Date(doc.createdAt), "dd MMM")}
                  </p>
                  <a
                    href="/documents"
                    className="text-xs text-brand-400 hover:underline"
                  >
                    Review →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {warning?.length > 0 && (
        <AlertSection
          icon={Clock}
          title="Warning — Expiring within 30 days"
          colour="yellow"
          items={warning}
          daysUntil={daysUntil}
        />
      )}
      {upcoming?.length > 0 && (
        <AlertSection
          icon={Clock}
          title="Upcoming — Expiring within 60 days"
          colour="blue"
          items={upcoming}
          daysUntil={daysUntil}
        />
      )}

      {/* ── Resolve complaint modal ── */}
      {resolving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Resolve Complaint
              </h3>
              <button
                onClick={() => setResolving(null)}
                className="text-slate-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs space-y-1">
              <p className="text-orange-400 font-semibold">
                {parseComplaint(resolving.feedback).category}
              </p>
              <p className="text-slate-400 font-mono">{resolving.reference}</p>
              <p className="text-slate-400">
                {resolving.passenger?.user?.firstName}{" "}
                {resolving.passenger?.user?.lastName}
              </p>
              {parseComplaint(resolving.feedback).description && (
                <p className="text-slate-500 pt-1">
                  {parseComplaint(resolving.feedback).description}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">
                Resolution note <span className="text-red-400">*</span>
              </label>
              <textarea
                className="input w-full resize-none text-sm"
                rows={4}
                placeholder="Describe what action was taken to resolve this complaint…"
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                autoFocus
              />
              <p className="text-[10px] text-slate-500 mt-1">
                This note will be visible to the passenger in their ride
                history.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setResolving(null)}
                className="flex-1 btn-ghost py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  acknowledgeMutation.mutate({
                    bookingId: resolving.id,
                    note: resolutionNote,
                  })
                }
                disabled={
                  !resolutionNote.trim() || acknowledgeMutation.isPending
                }
                className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-40"
              >
                {acknowledgeMutation.isPending
                  ? "Resolving…"
                  : "✓ Mark Resolved"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Update lost property modal ── */}
      {updatingLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Update Lost Property Report
              </h3>
              <button
                onClick={() => setUpdatingLost(null)}
                className="text-slate-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs space-y-1">
              <p className="text-slate-400 font-mono">
                {updatingLost.booking?.reference}
              </p>
              <p className="text-slate-400">
                {updatingLost.passenger?.user?.firstName}{" "}
                {updatingLost.passenger?.user?.lastName} ·{" "}
                {updatingLost.contactPhone}
              </p>
              <p className="text-slate-300 pt-1">{updatingLost.description}</p>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">
                Status
              </label>
              <select
                className="input w-full"
                value={lostStatus}
                onChange={(e) => setLostStatus(e.target.value)}
              >
                {LOST_PROPERTY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">
                Notes (visible to passenger)
              </label>
              <textarea
                className="input w-full resize-none text-sm"
                rows={3}
                placeholder="e.g. Item found, will contact driver to arrange return…"
                value={lostNotes}
                onChange={(e) => setLostNotes(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setUpdatingLost(null)}
                className="flex-1 btn-ghost py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  updateLostMutation.mutate({
                    id: updatingLost.id,
                    status: lostStatus,
                    adminNotes: lostNotes,
                  })
                }
                disabled={updateLostMutation.isPending}
                className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-40"
              >
                {updateLostMutation.isPending ? "Saving…" : "Save Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertSection({ icon: Icon, title, colour, items, daysUntil }: any) {
  const colours: Record<string, string> = {
    red: "text-red-400 border-red-500/20",
    yellow: "text-yellow-400 border-yellow-500/20",
    blue: "text-blue-400 border-blue-500/20",
  };
  const text = colours[colour].split(" ")[0];
  const border = colours[colour].split(" ")[1];
  return (
    <div className={`card ${border}`}>
      <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
        <Icon size={14} className={text} />
        <p className="text-sm font-semibold text-white">
          {title} ({items.length})
        </p>
      </div>
      <div className="divide-y divide-[#1e2d42]">
        {items.map((doc: any) => {
          const days = daysUntil(doc.expiryDate);
          const driverUser = doc.driver?.user ?? doc.driver?.driver?.user;
          return (
            <div
              key={doc.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold">
                  {driverUser?.firstName?.[0]}
                  {driverUser?.lastName?.[0]}
                </div>
                <div>
                  <p className="text-xs text-white">
                    {driverUser?.firstName} {driverUser?.lastName}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {doc.type?.replace(/_/g, " ")}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-semibold ${text}`}>
                  {days} days left
                </p>
                <p className="text-[10px] text-slate-600">
                  {format(new Date(doc.expiryDate), "dd MMM yyyy")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
