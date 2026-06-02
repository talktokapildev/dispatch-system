"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  FileText,
  ExternalLink,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { Spinner, Modal } from "@/components/ui";
import toast from "react-hot-toast";
import { ApplicationStatusBadge } from "../ApplicationStatusBadge";

const DOCUMENT_SLOTS = [
  { key: "docPcoBadge", label: "PCO Badge" },
  { key: "docDrivingLicFront", label: "Driving Licence (Front)" },
  { key: "docDrivingLicBack", label: "Driving Licence (Back)" },
  { key: "docPhvLicence", label: "PHV Licence" },
  { key: "docInsurance", label: "Insurance Certificate", multi: true },
  { key: "docMot", label: "MOT Certificate" },
  { key: "docDbs", label: "DBS Certificate" },
  { key: "docV5c", label: "V5C Logbook", multi: true },
];

function DocumentCard({ label, url }: { label: string; url?: string | null }) {
  if (!url) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-[var(--card-hover)] p-4 min-h-[120px]">
        <FileText size={20} className="text-slate-600" />
        <p className="text-[10px] text-slate-600 text-center">{label}</p>
        <span className="text-[10px] text-slate-700">Not uploaded</span>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg border border-[var(--border)] overflow-hidden hover:border-brand-500/50 transition-colors"
    >
      <div className="relative bg-slate-900 aspect-[4/3] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <ExternalLink size={18} className="text-white" />
        </div>
      </div>
      <p className="text-[10px] text-slate-400 px-3 py-2 truncate border-t border-[var(--border)]">
        {label}
      </p>
    </a>
  );
}

function MultiDocumentCards({
  label,
  urls,
}: {
  label: string;
  urls: string[];
}) {
  if (!urls || urls.length === 0)
    return <DocumentCard label={label} url={null} />;
  return (
    <>
      {urls.map((url, idx) => (
        <DocumentCard
          key={idx}
          label={`${label} — Page ${idx + 1}`}
          url={url}
        />
      ))}
    </>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      <div className="text-xs font-medium" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-application", id],
    queryFn: () =>
      api
        .get(`/admin/driver-applications/${id}`)
        .then((r) => r.data.application),
  });

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/admin/driver-applications/${id}/approve`),
    onSuccess: () => {
      toast.success("Application approved — driver account created");
      qc.invalidateQueries({ queryKey: ["driver-applications"] });
      qc.invalidateQueries({ queryKey: ["driver-application", id] });
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Approval failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      api.patch(`/admin/driver-applications/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success("Application rejected");
      qc.invalidateQueries({ queryKey: ["driver-applications"] });
      qc.invalidateQueries({ queryKey: ["driver-application", id] });
      setShowRejectModal(false);
      setRejectReason("");
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Rejection failed"),
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.delete(`/admin/driver-applications/${id}`),
    onSuccess: () => {
      toast.success("Application archived");
      qc.invalidateQueries({ queryKey: ["driver-applications"] });
      router.push("/applications");
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Archive failed"),
  });

  const handleReject = () => {
    setRejectError("");
    if (!rejectReason.trim()) {
      setRejectError("Please provide a rejection reason");
      return;
    }
    rejectMutation.mutate(rejectReason.trim());
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size={28} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center py-24 gap-3">
        <AlertTriangle size={24} className="text-slate-600" />
        <p className="text-slate-500 text-sm">Application not found</p>
        <button
          onClick={() => router.push("/applications")}
          className="btn-ghost text-sm"
        >
          Back to Applications
        </button>
      </div>
    );
  }

  const app = data;
  const isPending = app.status === "PENDING" && !app.deletedAt;
  const isApproved = app.status === "APPROVED" && !app.deletedAt;
  const isRejected = app.status === "REJECTED" && !app.deletedAt;
  const isArchived = !!app.deletedAt;

  const docsUploaded = DOCUMENT_SLOTS.filter((s) => {
    const val = app[s.key];
    return s.multi ? Array.isArray(val) && val.length > 0 : !!val;
  }).length;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/applications")}
            className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors text-xs"
          >
            <ArrowLeft size={14} /> Applications
          </button>
          <span className="text-slate-700">/</span>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 font-bold shrink-0">
              {app.name?.charAt(0)?.toUpperCase()}
            </div>
            <div>
              <h1
                className="text-base font-semibold"
                style={{ color: "var(--text)" }}
              >
                {app.name}
              </h1>
              <p className="text-xs text-slate-500">
                Submitted{" "}
                {format(new Date(app.createdAt), "dd MMM yyyy 'at' HH:mm")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isArchived ? (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-slate-500/15 text-slate-400">
              ARCHIVED
            </span>
          ) : (
            <ApplicationStatusBadge status={app.status} />
          )}

          {/* Archive button — available on all non-archived applications */}
          {!isArchived && (
            <button
              onClick={() => setShowArchiveModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-600 text-slate-400 hover:bg-slate-700/40 transition-colors"
              title="Archive this application"
            >
              <Trash2 size={13} /> Archive
            </button>
          )}

          {isPending && (
            <>
              <button
                onClick={() => {
                  setShowRejectModal(true);
                  setRejectReason("");
                  setRejectError("");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <XCircle size={13} /> Reject
              </button>
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {approveMutation.isPending ? (
                  <Spinner size={12} />
                ) : (
                  <CheckCircle size={13} />
                )}
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {/* Archived banner */}
      {isArchived && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-slate-500/10 border border-slate-500/20">
          <Trash2 size={16} className="text-slate-400 shrink-0" />
          <p className="text-sm text-slate-400">
            This application was archived on{" "}
            {app.deletedAt
              ? format(new Date(app.deletedAt), "dd MMM yyyy 'at' HH:mm")
              : "—"}
            . To permanently delete all data, go to the{" "}
            <button
              onClick={() => router.push("/applications?status=ARCHIVED")}
              className="text-brand-400 hover:underline"
            >
              Archived tab
            </button>
            .
          </p>
        </div>
      )}

      {/* Rejection reason banner */}
      {isRejected && app.rejectionReason && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
          <XCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-400 mb-1">
              Rejection Reason
            </p>
            <p className="text-xs text-red-300">{app.rejectionReason}</p>
          </div>
        </div>
      )}

      {/* Approved banner */}
      {isApproved && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
          <CheckCircle size={16} className="text-green-400 shrink-0" />
          <p className="text-sm text-green-400">
            This application was approved on{" "}
            {app.reviewedAt
              ? format(new Date(app.reviewedAt), "dd MMM yyyy")
              : "—"}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: Details ── */}
        <div className="space-y-5">
          {/* Personal */}
          <div className="card p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">
              Personal Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Full Name" value={app.name} />
              <DetailRow
                label="Phone"
                value={<span className="font-mono">{app.phone}</span>}
              />
              {app.email && <DetailRow label="Email" value={app.email} />}
              {app.dateOfBirth && (
                <DetailRow
                  label="Date of Birth"
                  value={format(new Date(app.dateOfBirth), "dd MMM yyyy")}
                />
              )}
            </div>
          </div>

          {/* Licence */}
          <div className="card p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">
              Licence Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow
                label="PCO Badge Number"
                value={<span className="font-mono">{app.pcoBadgeNumber}</span>}
              />
              <DetailRow
                label="PCO Badge Expiry"
                value={format(new Date(app.pcoBadgeExpiry), "dd MMM yyyy")}
              />
              <DetailRow
                label="Driving Licence No."
                value={
                  <span className="font-mono">{app.drivingLicenceNumber}</span>
                }
              />
            </div>
          </div>

          {/* Vehicle */}
          <div className="card p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">
              Vehicle Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Make" value={app.vehicleMake} />
              <DetailRow label="Model" value={app.vehicleModel} />
              <DetailRow
                label="Registration"
                value={
                  <span className="font-mono uppercase">{app.vehicleReg}</span>
                }
              />
              <DetailRow label="Year" value={app.vehicleYear} />
              <DetailRow label="Colour" value={app.vehicleColour} />
            </div>
          </div>

          {/* Document expiry summary (shows driver-supplied dates) */}
          {(app.docPhvExpiry ||
            app.docInsuranceExpiry ||
            app.docMotExpiry ||
            app.docDbsExpiry) && (
            <div className="card p-5">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">
                Document Expiry Dates
              </p>
              <div className="grid grid-cols-2 gap-3">
                {app.docPhvExpiry && (
                  <DetailRow
                    label="PHV Licence Expiry"
                    value={format(new Date(app.docPhvExpiry), "dd MMM yyyy")}
                  />
                )}
                {app.docInsuranceExpiry && (
                  <DetailRow
                    label="Insurance Expiry"
                    value={format(
                      new Date(app.docInsuranceExpiry),
                      "dd MMM yyyy"
                    )}
                  />
                )}
                {app.docMotExpiry && (
                  <DetailRow
                    label="MOT Expiry"
                    value={format(new Date(app.docMotExpiry), "dd MMM yyyy")}
                  />
                )}
                {app.docDbsExpiry && (
                  <DetailRow
                    label="DBS Expiry"
                    value={format(new Date(app.docDbsExpiry), "dd MMM yyyy")}
                  />
                )}
              </div>
            </div>
          )}

          {/* Document progress summary */}
          <div className="card p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Document Progress
            </p>
            <div className="space-y-2">
              {DOCUMENT_SLOTS.map((slot) => {
                const val = app[slot.key];
                const present = slot.multi
                  ? Array.isArray(val) && val.length > 0
                  : !!val;
                const pages =
                  slot.multi && Array.isArray(val) ? val.length : null;
                return (
                  <div
                    key={slot.key}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-slate-400">{slot.label}</span>
                    {present ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <CheckCircle size={11} />
                        {pages !== null
                          ? `${pages} page${pages > 1 ? "s" : ""}`
                          : "Uploaded"}
                      </span>
                    ) : (
                      <span className="text-slate-600">Not uploaded</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between text-xs">
              <span className="text-slate-500">Total</span>
              <span
                className={
                  docsUploaded === 8
                    ? "text-green-400 font-medium"
                    : "text-yellow-400"
                }
              >
                {docsUploaded} / 8 uploaded
              </span>
            </div>
          </div>
        </div>

        {/* ── Right: Document images ── */}
        <div className="space-y-4">
          <div className="card p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">
              Document Images
            </p>
            <div className="grid grid-cols-2 gap-3">
              {DOCUMENT_SLOTS.map((slot) =>
                slot.multi ? (
                  <MultiDocumentCards
                    key={slot.key}
                    label={slot.label}
                    urls={app[slot.key] as string[]}
                  />
                ) : (
                  <DocumentCard
                    key={slot.key}
                    label={slot.label}
                    url={app[slot.key]}
                  />
                )
              )}
            </div>
            <p className="text-[10px] text-slate-600 mt-3">
              Click any image to open full size in a new tab
            </p>
          </div>
        </div>
      </div>

      {/* ── Bottom action bar ── */}
      {isPending && (
        <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-[var(--sidebar-bg)] border-t border-[var(--border)] flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Review all documents before approving or rejecting.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowArchiveModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-slate-600 text-slate-400 hover:bg-slate-700/40 transition-colors"
            >
              <Trash2 size={14} /> Archive
            </button>
            <button
              onClick={() => {
                setShowRejectModal(true);
                setRejectReason("");
                setRejectError("");
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <XCircle size={14} /> Reject Application
            </button>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="flex items-center gap-2 px-6 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {approveMutation.isPending ? (
                <Spinner size={14} />
              ) : (
                <CheckCircle size={14} />
              )}
              Approve & Create Account
            </button>
          </div>
        </div>
      )}

      {/* ── Archive modal ── */}
      <Modal
        open={showArchiveModal}
        onClose={() => setShowArchiveModal(false)}
        title="Archive Application"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-50 border border-yellow-300">
            <AlertTriangle
              size={16}
              className="text-yellow-600 shrink-0 mt-0.5"
            />
            <div className="text-xs text-yellow-900 space-y-1">
              <p className="font-semibold">Archive {app.name}'s application?</p>
              <p className="text-yellow-800">
                {app.status === "APPROVED"
                  ? "Their driver account will be suspended — they will no longer be able to log in or receive jobs. All data is preserved."
                  : "The application will be archived. All data is preserved and can be permanently deleted later."}
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setShowArchiveModal(false)}
              className="flex-1 btn-ghost py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => archiveMutation.mutate()}
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

      {/* ── Reject modal ── */}
      <Modal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Reject Application"
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            The applicant will be able to see this reason and resubmit after
            correcting the issue.
          </p>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">
              Rejection Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              className="input w-full resize-none"
              rows={4}
              placeholder="e.g. PCO badge image is unclear — please reupload a sharper photo."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
          </div>
          {rejectError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {rejectError}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setShowRejectModal(false)}
              className="flex-1 btn-ghost py-2.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleReject}
              disabled={rejectMutation.isPending}
              className="flex-1 btn-danger py-2.5 text-sm flex items-center justify-center gap-2"
            >
              {rejectMutation.isPending ? (
                <Spinner size={14} />
              ) : (
                <XCircle size={14} />
              )}
              Reject Application
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
