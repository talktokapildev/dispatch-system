"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Package,
  Plane,
  Plus,
} from "lucide-react";
import { SectionHeader, Spinner } from "@/components/ui";
import { LostPropertyModal, LP_STATUS, refreshLostProperty } from "@/components/LostProperty";
import { ComplaintModal, CC_STATUS, refreshComplaints } from "@/components/Complaints";
import { useAuthStore } from "@/lib/api";
import { useSocket } from "@/lib/socket";
import { useEffect, useState } from "react";

export default function AlertsPage() {
  const qc = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  // Complaint modal: { item } to update, { item: null, bookingId? } to log a new one
  const [complaintModal, setComplaintModal] = useState<{ item: any | null; bookingId?: string | null } | null>(null);
  const { token } = useAuthStore();
  const [showClosedLost, setShowClosedLost] = useState(false);
  // Lost property modal: { item } to update, { item: null, bookingId? } to log a new item
  const [lostModal, setLostModal] = useState<{ item: any | null; bookingId?: string | null } | null>(null);

  const { data: complaints, isLoading: loadingComplaints } = useQuery({
    queryKey: ["complaints"],
    queryFn: () => api.get("/admin/complaints").then((r) => r.data.data),
  });

  const { data: lostProperties, isLoading: loadingLost } = useQuery({
    queryKey: ["lost-property"],
    queryFn: () => api.get("/admin/lost-property").then((r) => r.data.data),
  });

  // Step 6a: unverified flights + bookings where an earlier pickup is possible.
  const { data: flightAlerts } = useQuery({
    queryKey: ["flight-alerts"],
    queryFn: () => api.get("/admin/flight-alerts").then((r) => r.data.data),
    refetchInterval: 60_000,
  });
  const unverifiedFlights: any[] = flightAlerts?.unverified ?? [];
  const earlierPossible: any[] = flightAlerts?.earlierPossible ?? [];

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

  // New complaints / lost property reports appear without reloading
  useSocket(token, {
    "admin:complaint": () => refreshComplaints(qc),
    "admin:lost_property": () => refreshLostProperty(qc),
  });

  // Deep links: /alerts?logLost=<bookingId> · /alerts?logComplaint=<bookingId> (Bookings page)
  //             /alerts?lost=<itemId> · /alerts?complaint=<id> (TfL Records)
  const [linkHandled, setLinkHandled] = useState(false);
  useEffect(() => {
    if (linkHandled || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const bookingId = q.get("logLost");
    const itemId = q.get("lost");
    const complaintBooking = q.get("logComplaint");
    const complaintId = q.get("complaint");
    if (complaintBooking) {
      setComplaintModal({ item: null, bookingId: complaintBooking });
      setLinkHandled(true);
      return;
    }
    if (complaintId) {
      if (!complaints) return;
      const found = complaints.find((c: any) => c.id === complaintId);
      if (found) setComplaintModal({ item: found });
      setLinkHandled(true);
      return;
    }
    if (bookingId) {
      setLostModal({ item: null, bookingId });
      setLinkHandled(true);
    } else if (itemId && lostProperties) {
      const found = lostProperties.find((l: any) => l.id === itemId);
      if (found) setLostModal({ item: found });
      setLinkHandled(true);
    } else if (!itemId) setLinkHandled(true);
  }, [linkHandled, lostProperties, complaints]);
  const closeComplaintModal = () => {
    setComplaintModal(null);
    if (typeof window !== "undefined" && window.location.search) window.history.replaceState(null, "", "/alerts");
  };
  const closeLostModal = () => {
    setLostModal(null);
    if (typeof window !== "undefined" && window.location.search) window.history.replaceState(null, "", "/alerts");
  };

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
    (c: any) => c.status === "RECEIVED" || c.status === "INVESTIGATING"
  );
  const resolvedComplaints = (complaints ?? []).filter(
    (c: any) => c.status === "RESOLVED" || c.status === "CLOSED"
  );
  // Open compliments are listed but don't count as needing attention
  const openComplaintCount = unresolvedComplaints.filter((c: any) => c.type === "COMPLAINT").length;

  const openLost = (lostProperties ?? []).filter(
    (l: any) => !["RETURNED", "CLOSED"].includes(l.status)
  );
  const closedLost = (lostProperties ?? []).filter((l: any) =>
    ["RETURNED", "CLOSED"].includes(l.status)
  );

  const totalAlerts =
    unverifiedFlights.length +
    earlierPossible.length +
    (critical?.length ?? 0) +
    (warning?.length ?? 0) +
    (pendingDocs?.length ?? 0) +
    openComplaintCount +
    openLost.length;

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
              No flight issues, complaints, lost property, expiring documents
              or pending reviews
            </p>
          </div>
        )}

      {/* ── Flights (step 6a) ── */}
      {(unverifiedFlights.length > 0 || earlierPossible.length > 0) && (
        <div className="card border-amber-500/20">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
            <Plane size={14} className="text-amber-400" />
            <p className="text-sm font-semibold text-white">Flights</p>
            <span className="ml-auto text-[10px] text-slate-500">
              refreshes every minute
            </span>
          </div>
          <div className="divide-y divide-[#1e2d42]">
            {unverifiedFlights.map((w: any) => (
              <div key={w.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-amber-400">
                    ⚠ Unverified
                  </span>
                  <span className="text-xs text-white">{w.flightNumber}</span>
                  <span className="text-[10px] text-slate-500">
                    expected {ukTime(w.expectedGateArrivalAt)} · last data{" "}
                    {w.lastCheckedAt ? ukTime(w.lastCheckedAt) : "never"}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  No fresh flight data near arrival — check Gatwick arrivals or
                  call the passenger.
                </p>
                {w.bookings.map((b: any) => (
                  <a
                    key={b.id}
                    href={`/bookings?open=${b.id}`}
                    className="flex items-center gap-2 mt-1 text-xs hover:underline"
                  >
                    <span className="font-mono text-brand-400">
                      {b.reference}
                    </span>
                    <span className="text-slate-300">
                      {b.passenger?.user?.firstName}{" "}
                      {b.passenger?.user?.lastName}
                    </span>
                    <span className="text-slate-500">
                      {b.passenger?.user?.phone} · pickup{" "}
                      {ukTime(b.scheduledAt)}
                    </span>
                  </a>
                ))}
              </div>
            ))}
            {earlierPossible.map((b: any) => (
              <a
                key={b.id}
                href={`/bookings?open=${b.id}`}
                className="block px-4 py-3 hover:bg-[var(--card-hover)]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-green-400">
                    Earlier pickup possible
                  </span>
                  <span className="font-mono text-[10px] text-brand-400">
                    {b.reference}
                  </span>
                  <span className="text-xs text-white">{b.flightNumber}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ready from {ukTime(b.earliestAt)} · pickup now{" "}
                  {ukTime(b.scheduledAt)} · {b.passenger?.user?.firstName}{" "}
                  {b.passenger?.user?.lastName} — open to confirm →
                </p>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Lost Property (TfL Condition 9) ── */}
      {!loadingLost && (
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
              {openLost.length === 0 && closedLost.length > 0 && (
                <span className="ml-1.5 text-green-400">(all resolved)</span>
              )}
            </p>
            <span className="ml-auto text-[10px] text-slate-500">
              TfL Condition 9
            </span>
            <button
              onClick={() => setLostModal({ item: null })}
              className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white border border-[var(--border)] hover:border-brand-500 rounded px-2 py-1 transition-colors"
            >
              <Plus size={11} /> Log item
            </button>
          </div>

          {openLost.length === 0 && (
            <div className="px-4 py-4 text-xs text-slate-500 text-center">
              No open items
            </div>
          )}

          <div className="divide-y divide-[#1e2d42]">
            {openLost.map((l: any) => (
              <div key={l.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold ${LP_STATUS[l.status]?.color}`}>
                        {LP_STATUS[l.status]?.label}
                      </span>
                      <span className="text-[10px] font-mono text-slate-300">{l.refNo}</span>
                      {l.booking?.reference && (
                        <span className="text-[10px] font-mono text-brand-400">{l.booking.reference}</span>
                      )}
                      <span className="text-[10px] text-slate-500">
                        {format(new Date(l.receivedAt ?? l.reportedAt), "dd MMM yyyy HH:mm")}
                        {l.source === "ADMIN_FOUND" ? " · logged by staff" : ""}
                      </span>
                      {l.overdue && (
                        <span
                          className="text-[10px] font-semibold text-amber-400 border border-amber-500/40 rounded px-1.5"
                          title="Open 28 days or more: consider handing it to the police or disposing of it"
                        >
                          {l.daysOpen} days — police / disposal?
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {l.customerName ?? "No customer yet"}
                      {l.contactPhone && (
                        <>
                          {" · "}
                          <span className="text-slate-500">{l.contactPhone}</span>
                        </>
                      )}
                      {l.vehicleReg && <span className="text-slate-500 font-mono"> · {l.vehicleReg}</span>}
                      {l.handedInByName && <span className="text-slate-500"> · handed in by {l.handedInByName}</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{l.description}</p>
                    {l.contacts?.length > 0 && (
                      <p className="text-xs text-blue-400 mt-1 line-clamp-1">
                        Latest: {l.contacts[l.contacts.length - 1].note}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setLostModal({ item: l })}
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
                  {closedLost.length} resolved item
                  {closedLost.length > 1 ? "s" : ""}
                </span>
                {showClosedLost ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showClosedLost && (
                <div className="divide-y divide-[#1e2d42]">
                  {closedLost.map((l: any) => (
                    <button
                      key={l.id}
                      onClick={() => setLostModal({ item: l })}
                      className="w-full text-left px-4 py-3 opacity-70 hover:opacity-100 transition-opacity"
                    >
                      <div className="flex items-start gap-3">
                        <CheckCircle size={12} className="text-green-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold ${LP_STATUS[l.status]?.color}`}>
                              {LP_STATUS[l.status]?.label}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">{l.refNo}</span>
                            {l.booking?.reference && (
                              <span className="text-[10px] font-mono text-slate-500">{l.booking.reference}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{l.customerName ?? "No customer"}</p>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{l.description}</p>
                          <p className="text-xs text-green-500 mt-0.5">
                            ✓ {l.outcomeLabel ?? "Result not recorded (closed before the register was kept)"}
                            {l.outcomeDetails ? ` — ${l.outcomeDetails}` : ""}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Complaints / compliments (TfL Condition 7) ── */}
      {loadingComplaints ? (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="card border-orange-500/20">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
            <MessageSquareWarning size={14} className="text-orange-400" />
            <p className="text-sm font-semibold text-white">
              Complaints &amp; Compliments
              {openComplaintCount > 0 && (
                <span className="ml-1.5 text-orange-400">
                  ({openComplaintCount} open complaint{openComplaintCount === 1 ? "" : "s"})
                </span>
              )}
              {openComplaintCount === 0 && resolvedComplaints.length > 0 && (
                <span className="ml-1.5 text-green-400">(no open complaints)</span>
              )}
            </p>
            <span className="ml-auto text-[10px] text-slate-500">TfL Condition 7</span>
            <button
              onClick={() => setComplaintModal({ item: null })}
              className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white border border-[var(--border)] hover:border-brand-500 rounded px-2 py-1 transition-colors"
            >
              <Plus size={11} /> Log
            </button>
          </div>

          {unresolvedComplaints.length === 0 && (
            <div className="px-4 py-4 text-xs text-slate-500 text-center">Nothing open</div>
          )}

          <div className="divide-y divide-[#1e2d42]">
            {unresolvedComplaints.map((c: any) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold ${CC_STATUS[c.status]?.color}`}>
                        {c.type === "COMPLIMENT" ? "Compliment" : c.category ?? "Complaint"}
                      </span>
                      <span className="text-[10px] font-mono text-slate-300">{c.refNo}</span>
                      {c.booking?.reference && (
                        <span className="text-[10px] font-mono text-brand-400">{c.booking.reference}</span>
                      )}
                      <span className="text-[10px] text-slate-500">
                        {format(new Date(c.receivedAt), "dd MMM yyyy HH:mm")} · {CC_STATUS[c.status]?.label.toLowerCase()} · via{" "}
                        {c.channelLabel?.toLowerCase()}
                      </span>
                      {c.replyOverdue && (
                        <span
                          className="text-[10px] font-semibold text-amber-400 border border-amber-500/40 rounded px-1.5"
                          title="The app promises a reply within 48 hours — add a history entry when you contact them"
                        >
                          reply overdue — {c.hoursOpen} h
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {c.complainantName ?? "No name"}
                      {c.complainantPhone && <span className="text-slate-500"> · {c.complainantPhone}</span>}
                      {c.driverName && <span className="text-slate-500"> · driver {c.driverName}</span>}
                      {c.handledByName && <span className="text-slate-500"> · handled by {c.handledByName}</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{c.details}</p>
                    {c.contacts?.length > 0 && (
                      <p className="text-xs text-blue-400 mt-1 line-clamp-1">Latest: {c.contacts[c.contacts.length - 1].note}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setComplaintModal({ item: c })}
                    className="shrink-0 text-[10px] text-slate-400 hover:text-orange-400 border border-[var(--border)] hover:border-orange-500/40 rounded px-2 py-1 transition-colors whitespace-nowrap"
                  >
                    Update
                  </button>
                </div>
              </div>
            ))}
          </div>

          {resolvedComplaints.length > 0 && (
            <>
              <button
                onClick={() => setShowResolved(!showResolved)}
                className="w-full flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <span>
                  {resolvedComplaints.length} resolved / closed
                </span>
                {showResolved ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showResolved && (
                <div className="divide-y divide-[#1e2d42]">
                  {resolvedComplaints.map((c: any) => (
                    <button
                      key={c.id}
                      onClick={() => setComplaintModal({ item: c })}
                      className="w-full text-left px-4 py-3 opacity-70 hover:opacity-100 transition-opacity"
                    >
                      <div className="flex items-start gap-3">
                        <CheckCircle size={12} className="text-green-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-slate-400">
                              {c.type === "COMPLIMENT" ? "Compliment" : c.category ?? "Complaint"}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">{c.refNo}</span>
                            {c.booking?.reference && (
                              <span className="text-[10px] font-mono text-slate-500">{c.booking.reference}</span>
                            )}
                            <span className="text-[10px] text-slate-600">{format(new Date(c.receivedAt), "dd MMM yyyy")}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{c.complainantName ?? "No name"}</p>
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">{c.details}</p>
                          <p className="text-xs text-green-600 mt-1">
                            ✓ {c.outcomeLabel ?? c.statusLabel}
                            {c.resolutionNote ? ` — ${c.resolutionNote}` : ""}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
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

      {/* ── Complaints: log / update ── */}
      <ComplaintModal
        open={!!complaintModal}
        item={complaintModal?.item ?? null}
        bookingId={complaintModal?.bookingId ?? null}
        onClose={closeComplaintModal}
      />

      {/* ── Lost property: log / update ── */}
      <LostPropertyModal
        open={!!lostModal}
        item={lostModal?.item ?? null}
        bookingId={lostModal?.bookingId ?? null}
        onClose={closeLostModal}
      />
    </div>
  );
}

/** UK time, "12 Oct, 15:25". */
function ukTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
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
