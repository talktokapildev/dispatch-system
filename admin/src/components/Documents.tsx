"use client";
// Driver & vehicle documents: review (approve with expiry / reject with reason), admin upload,
// and the per-driver / per-vehicle panel used on the Drivers and Vehicles pages.
//
// Rules (backend/src/services/documentRules.ts):
// - Driver documents: PCO badge, driving licence front + back, DBS.
// - Vehicle documents (current car): PHV vehicle licence, insurance, MOT, V5C.
// - Each upload is a new version; the approved one stays in force until a newer one is approved
//   or it expires. Approving needs an expiry date for PCO, PHV, insurance and MOT.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { Modal, Spinner } from "@/components/ui";

export const DOC_LABELS: Record<string, string> = {
  PCO_LICENSE: "PCO badge",
  DRIVING_LICENSE: "Driving licence (front)",
  DRIVING_LICENSE_BACK: "Driving licence (back)",
  DBS_CHECK: "DBS certificate",
  PHV_LICENCE: "PHV vehicle licence",
  VEHICLE_INSURANCE: "Insurance",
  MOT_CERTIFICATE: "MOT",
  V5C_LOGBOOK: "V5C logbook",
  PROFILE_PHOTO: "Profile photo",
  VEHICLE_PHOTO: "Vehicle photo",
};
export const DRIVER_DOC_TYPES = ["PCO_LICENSE", "DRIVING_LICENSE", "DRIVING_LICENSE_BACK", "DBS_CHECK"];
export const VEHICLE_DOC_TYPES = ["PHV_LICENCE", "VEHICLE_INSURANCE", "MOT_CERTIFICATE", "V5C_LOGBOOK"];
export const EXPIRY_REQUIRED = new Set(["PCO_LICENSE", "PHV_LICENCE", "VEHICLE_INSURANCE", "MOT_CERTIFICATE"]);

const errMsg = (err: any, fallback: string) => err?.response?.data?.error ?? fallback;
const dateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const fmt = (d?: string | null) => (d ? format(new Date(d), "dd MMM yyyy") : "—");

/** Invalidate everything that shows documents or compliance. */
export function useRefreshDocuments() {
  const qc = useQueryClient();
  return () =>
    ["docs", "docs-counts", "doc-panel", "drivers", "vehicles", "vehicle", "expiring-docs", "dashboard"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] })
    );
}

// ── Chips ────────────────────────────────────────────────────────────────────

const STATE_STYLE: Record<string, [string, string]> = {
  valid: ["Valid", "bg-green-500/15 text-green-400"],
  pending: ["Waiting for review", "bg-yellow-500/15 text-yellow-400"],
  rejected: ["Rejected", "bg-red-500/15 text-red-400"],
  expired: ["Expired", "bg-red-500/15 text-red-400"],
  expiry_needed: ["No expiry date", "bg-orange-500/15 text-orange-400"],
  missing: ["Missing", "bg-slate-500/15 text-slate-400"],
  PENDING: ["Pending", "bg-yellow-500/15 text-yellow-400"],
  APPROVED: ["Approved", "bg-green-500/15 text-green-400"],
  REJECTED: ["Rejected", "bg-red-500/15 text-red-400"],
  EXPIRED: ["Expired", "bg-slate-500/15 text-slate-400"],
};

export function StateChip({ state }: { state: string }) {
  const [label, cls] = STATE_STYLE[state] ?? [state, "bg-slate-500/15 text-slate-400"];
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{label}</span>;
}

/** "18 May 2027" coloured by days left; "—" when none. */
export function ExpiryText({ date, daysLeft }: { date?: string | null; daysLeft?: number | null }) {
  if (!date) return <span className="text-xs text-slate-600">—</span>;
  const n = daysLeft ?? Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  const cls = n < 0 ? "text-red-400 font-medium" : n <= 30 ? "text-amber-400 font-medium" : "text-slate-400";
  return (
    <span className={`text-xs ${cls}`} title={n < 0 ? "Expired" : n === 0 ? "Expires today" : `${n} days left`}>
      {n <= 30 && <AlertTriangle size={10} className="inline mr-1" />}
      {fmt(date)}
      {n < 0 ? " (expired)" : n <= 30 ? ` (${n}d)` : ""}
    </span>
  );
}

function Pages({ doc }: { doc: any }) {
  const pages: string[] = doc.pages ?? [doc.fileUrl, ...(doc.pageUrls ?? [])];
  return (
    <div className="flex flex-wrap gap-2">
      {pages.filter(Boolean).map((url, i) => {
        const isPdf = /\.pdf($|\?)/i.test(url);
        return (
          <a
            key={url + i}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-[var(--border)] overflow-hidden hover:border-brand-500 transition-colors"
            title={`Open page ${i + 1}`}
          >
            {isPdf ? (
              <div className="w-28 h-20 flex flex-col items-center justify-center text-xs text-slate-400 gap-1">
                <FileText size={16} /> PDF page {i + 1}
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`Page ${i + 1}`} className="w-28 h-20 object-cover" />
            )}
          </a>
        );
      })}
    </div>
  );
}

// ── Review ───────────────────────────────────────────────────────────────────

/**
 * Review a pending upload (approve with expiry / reject with reason), or correct the expiry date
 * of the approved version in force.
 */
export function ReviewModal({ doc, onClose }: { doc: any | null; onClose: () => void }) {
  const refresh = useRefreshDocuments();
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (doc && doc.id !== lastId) {
    setLastId(doc.id);
    setExpiry(dateInput(doc.expiryDate));
    setReason("");
    setNotes(doc.notes ?? "");
    setRejecting(false);
  }

  const review = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api.post(`/admin/documents/${doc.id}/review`, {
        decision,
        expiryDate: expiry || null,
        rejectionReason: decision === "reject" ? reason : null,
        notes: notes || null,
      }),
    onSuccess: (_r, decision) => {
      toast.success(decision === "approve" ? "Approved — driver notified" : "Rejected — driver notified");
      refresh();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Review failed")),
  });

  if (!doc) return null;
  const type = doc.type as string;
  const needsExpiry = EXPIRY_REQUIRED.has(type);
  const isApproved = doc.status === "APPROVED";
  const owner = doc.owner;

  return (
    <Modal open={!!doc} onClose={onClose} title={`${isApproved ? "Approved" : "Review"}: ${DOC_LABELS[type] ?? type}`} size="lg">
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--text)] font-medium">{owner?.label ?? "—"}</p>
            <StateChip state={doc.status} />
          </div>
          <p className="text-xs text-slate-500">
            {owner?.kind === "vehicle" ? "Vehicle document" : "Driver document"} · uploaded {fmt(doc.createdAt)}
            {doc.reviewedAt && ` · reviewed ${fmt(doc.reviewedAt)}`}
          </p>
          {doc.rejectionReason && <p className="text-xs text-red-400">Rejected: {doc.rejectionReason}</p>}
        </div>

        <Pages doc={doc} />

        {doc.status !== "REJECTED" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              Expiry date {needsExpiry ? <span className="text-red-400">*</span> : <span className="text-slate-600">(optional)</span>}
            </label>
            <input type="date" className="input w-full" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            <p className="text-[10px] text-slate-500 mt-1">
              {doc.expiryDate && !isApproved ? "Entered by the driver — check it against the document." : "As printed on the document."}
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Internal notes</label>
            <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Not shown to the driver" />
          </div>
        </div>
        )}

        {rejecting && (
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              Reason for the driver <span className="text-red-400">*</span>
            </label>
            <textarea
              className="input w-full resize-none h-16"
              placeholder="e.g. Photo is blurry — please retake in good light"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}

        {doc.status === "REJECTED" ? (
          <p className="text-xs text-slate-500">Rejected versions can't be changed — the driver uploads a new copy, or upload one yourself.</p>
        ) : (
        <div className="flex gap-3">
          {!rejecting && (
            <button
              onClick={() => review.mutate("approve")}
              disabled={review.isPending || (needsExpiry && !expiry)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 text-sm font-medium transition-all disabled:opacity-40"
            >
              <CheckCircle size={14} /> {isApproved ? "Save expiry date" : "Approve"}
            </button>
          )}
          {!isApproved && (
            <button
              onClick={() => (rejecting ? review.mutate("reject") : setRejecting(true))}
              disabled={review.isPending || (rejecting && !reason.trim())}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm font-medium transition-all disabled:opacity-40"
            >
              <XCircle size={14} /> {rejecting ? "Reject and tell driver" : "Reject…"}
            </button>
          )}
          {rejecting && (
            <button onClick={() => setRejecting(false)} className="btn-ghost border border-[var(--border)] text-sm px-3">
              Cancel
            </button>
          )}
        </div>
        )}
      </div>
    </Modal>
  );
}

// ── Admin upload ─────────────────────────────────────────────────────────────

export function UploadModal({
  open,
  onClose,
  driverId,
  vehicleId,
  types,
  defaultType,
  ownerLabel,
}: {
  open: boolean;
  onClose: () => void;
  driverId?: string | null;
  vehicleId?: string | null;
  types: string[];
  defaultType?: string;
  ownerLabel: string;
}) {
  const refresh = useRefreshDocuments();
  const [type, setType] = useState(defaultType ?? types[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [expiry, setExpiry] = useState("");
  const [approve, setApprove] = useState(true);
  const [lastKey, setLastKey] = useState("");
  const key = `${open}:${defaultType}`;
  if (key !== lastKey) {
    setLastKey(key);
    setType(defaultType ?? types[0]);
    setFiles([]);
    setExpiry("");
    setApprove(true);
  }

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("type", type);
      if (driverId) form.append("driverId", driverId);
      if (vehicleId) form.append("vehicleId", vehicleId);
      if (expiry) form.append("expiryDate", expiry);
      form.append("approve", String(approve));
      files.forEach((f) => form.append("file", f, f.name));
      return api.post("/admin/documents", form); // browser sets the multipart boundary
    },
    onSuccess: () => {
      toast.success(approve ? "Uploaded and approved" : "Uploaded — waiting for review");
      refresh();
      onClose();
    },
    onError: (err) => toast.error(errMsg(err, "Upload failed")),
  });

  const needsExpiry = EXPIRY_REQUIRED.has(type);
  const blocked = !files.length || (approve && needsExpiry && !expiry);

  return (
    <Modal open={open} onClose={onClose} title={`Upload document — ${ownerLabel}`}>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Document</label>
          <select className="input w-full" value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {DOC_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">File(s) — photos or PDF, one per page (max 6)</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="input w-full"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">
            Expiry date {needsExpiry ? <span className="text-red-400">*</span> : <span className="text-slate-600">(optional)</span>}
          </label>
          <input type="date" className="input w-full" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="mt-0.5" />
          Approve now — I&apos;ve checked the original. It replaces the version in force and the driver is notified.
        </label>
        <button
          onClick={() => upload.mutate()}
          disabled={blocked || upload.isPending}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-black text-sm font-semibold disabled:opacity-40"
        >
          {upload.isPending ? <Spinner size={14} /> : <Upload size={14} />} Upload
        </button>
      </div>
    </Modal>
  );
}

// ── Panel (Drivers / Vehicles detail) ────────────────────────────────────────

export function DocumentsPanel({
  driverId,
  vehicleId,
  ownerLabel,
}: {
  driverId?: string;
  vehicleId?: string;
  ownerLabel: string;
}) {
  const [reviewing, setReviewing] = useState<any>(null);
  const [uploadType, setUploadType] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["doc-panel", driverId ?? null, vehicleId ?? null],
    queryFn: () =>
      api
        .get("/admin/documents/panel", { params: driverId ? { driverId } : { vehicleId } })
        .then((r) => r.data.data),
    enabled: !!(driverId || vehicleId),
  });

  if (isLoading || !data)
    return (
      <div className="flex justify-center py-4">
        <Spinner size={16} />
      </div>
    );

  const items: any[] = data.items ?? [];
  const history: any[] = data.history ?? [];
  const compliance = data.compliance;
  const uploadTypes = [
    ...(driverId ? DRIVER_DOC_TYPES : []),
    ...(data.vehicle ? VEHICLE_DOC_TYPES : []),
  ];
  const section = (owner: "driver" | "vehicle") => items.filter((i) => i.owner === owner);

  const Row = ({ item }: { item: any }) => {
    const shown = item.current ?? item.pending ?? item.rejected;
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
        <FileText size={12} className="text-slate-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--text)] font-medium">{item.label}</span>
            <StateChip state={item.state} />
            {item.state === "valid" && item.pending && <StateChip state="PENDING" />}
            {item.inGrace && <span className="text-[10px] text-orange-400">add expiry date</span>}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 flex gap-2 flex-wrap">
            {item.current ? (
              <ExpiryText date={item.current.expiryDate} daysLeft={item.daysLeft} />
            ) : (
              <span>Not on file</span>
            )}
            {item.rejected?.rejectionReason && <span className="text-red-400">Rejected: {item.rejected.rejectionReason}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {item.pending && (
            <button onClick={() => setReviewing(item.pending)} className="text-[11px] px-2 py-1 rounded bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25">
              Review
            </button>
          )}
          {item.current && (
            <button onClick={() => setReviewing(item.current)} className="text-[11px] px-2 py-1 rounded text-brand-400 hover:bg-brand-500/10">
              {item.inGrace || (item.expiryRequired && !item.current.expiryDate) ? "Add date" : "View"}
            </button>
          )}
          {!item.current && !item.pending && shown && (
            <button onClick={() => setReviewing(shown)} className="text-[11px] px-2 py-1 rounded text-brand-400 hover:bg-brand-500/10">
              View
            </button>
          )}
          <button
            onClick={() => setUploadType(item.type)}
            className="text-[11px] px-2 py-1 rounded text-slate-400 hover:bg-[var(--table-hover)]"
            title="Upload a new copy"
          >
            <Upload size={11} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {compliance && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
            compliance.eligible
              ? "bg-green-500/5 border-green-500/20 text-green-400"
              : "bg-red-500/5 border-red-500/20 text-red-400"
          }`}
        >
          {compliance.eligible ? <CheckCircle size={13} className="mt-0.5" /> : <AlertTriangle size={13} className="mt-0.5" />}
          <div>
            {compliance.eligible ? "Documents in order — can take jobs." : compliance.message}
            {!compliance.eligible && !compliance.enforced && (
              <p className="text-[10px] text-slate-500 mt-0.5">Not enforced yet (shadow mode) — jobs still go to this driver.</p>
            )}
          </div>
        </div>
      )}

      {driverId && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Driver documents</p>
          <div className="space-y-1.5">
            {section("driver").map((i) => (
              <Row key={i.type} item={i} />
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Vehicle documents{data.vehicle ? ` — ${data.vehicle.licensePlate}` : ""}
        </p>
        {data.vehicle ? (
          <div className="space-y-1.5">
            {section("vehicle").map((i) => (
              <Row key={i.type} item={i} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No vehicle assigned — assign one on the Vehicles page.</p>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500 hover:text-slate-300"
          >
            {showHistory ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Older versions ({history.length})
          </button>
          {showHistory && (
            <div className="mt-2 space-y-1">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setReviewing(h)}
                  className="w-full flex items-center justify-between gap-2 text-xs p-2 rounded-lg hover:bg-[var(--card-hover)] text-left"
                >
                  <span className="text-slate-300">{h.label}</span>
                  <span className="text-slate-500">
                    {h.status === "APPROVED" ? `expired/replaced · ${fmt(h.expiryDate)}` : h.status.toLowerCase()} · uploaded {fmt(h.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ReviewModal doc={reviewing?.replacedAt ? null : reviewing} onClose={() => setReviewing(null)} />
      <HistoryModal doc={reviewing?.replacedAt ? reviewing : null} onClose={() => setReviewing(null)} />
      <UploadModal
        open={!!uploadType}
        onClose={() => setUploadType(null)}
        driverId={driverId ?? null}
        vehicleId={data.vehicle?.id ?? vehicleId ?? null}
        types={uploadTypes}
        defaultType={uploadType ?? undefined}
        ownerLabel={ownerLabel}
      />
    </div>
  );
}

/** Read-only view of an older (replaced) version. */
function HistoryModal({ doc, onClose }: { doc: any | null; onClose: () => void }) {
  if (!doc) return null;
  return (
    <Modal open onClose={onClose} title={`${DOC_LABELS[doc.type] ?? doc.type} — older version`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          {doc.status.toLowerCase()} · uploaded {fmt(doc.createdAt)} · expiry {fmt(doc.expiryDate)} · replaced {fmt(doc.replacedAt)}
        </p>
        {doc.rejectionReason && <p className="text-xs text-red-400">Rejected: {doc.rejectionReason}</p>}
        <Pages doc={doc} />
      </div>
    </Modal>
  );
}
