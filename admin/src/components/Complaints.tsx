"use client";
// admin/src/components/Complaints.tsx
//
// Complaints / compliments (TfL Condition 7): the modal used on Alerts to log a complaint or
// compliment (phone, email, in person) and to update one — status, outcome and resolution
// (shown to the passenger), a new history entry ("Method/Enquiry to resolve complaint"), and the
// TfL record details. API: POST /admin/complaints, PUT /admin/complaints/:id.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { Modal } from "@/components/ui";
import { ukDateTime } from "@/components/LostProperty";

export const CC_STATUS: Record<string, { label: string; color: string }> = {
  RECEIVED: { label: "Received", color: "text-orange-400" },
  INVESTIGATING: { label: "Investigating", color: "text-blue-400" },
  RESOLVED: { label: "Resolved", color: "text-green-400" },
  CLOSED: { label: "Closed", color: "text-slate-400" },
};
const STATUSES_FOR: Record<string, string[]> = {
  COMPLAINT: ["RECEIVED", "INVESTIGATING", "RESOLVED"],
  COMPLIMENT: ["RECEIVED", "CLOSED"],
};
export const CC_OUTCOMES = [
  { value: "UPHELD", label: "Upheld" },
  { value: "PARTLY_UPHELD", label: "Partly upheld" },
  { value: "NOT_UPHELD", label: "Not upheld" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];
const CHANNELS = [
  { value: "PHONE", label: "Phone" },
  { value: "EMAIL", label: "Email" },
  { value: "IN_PERSON", label: "In person" },
  { value: "APP", label: "App" },
];
const CATEGORIES = ["Driver behaviour", "Vehicle condition", "Late arrival", "Wrong route taken", "Overcharged", "Safety concern", "Other"];
const isDone = (s: string) => s === "RESOLVED" || s === "CLOSED";
const errorText = (err: any, fallback: string) => err?.response?.data?.error ?? fallback;

export function refreshComplaints(qc: ReturnType<typeof useQueryClient>) {
  ["complaints", "tfl-complaint", "tfl-complaints-register", "feedback"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

type Details = {
  type: string;
  channel: string;
  category: string;
  details: string;
  bookingReference: string;
  handledByUserId: string;
  receivedAt: string;
  bookingDateTime: string;
  complainantName: string;
  complainantPhone: string;
  complainantAddress: string;
  driverName: string;
  vehicleReg: string;
};

const EMPTY: Details = {
  type: "COMPLAINT",
  channel: "PHONE",
  category: "",
  details: "",
  bookingReference: "",
  handledByUserId: "",
  receivedAt: "",
  bookingDateTime: "",
  complainantName: "",
  complainantPhone: "",
  complainantAddress: "",
  driverName: "",
  vehicleReg: "",
};

function detailsOf(c: any): Details {
  return {
    type: c.type,
    channel: c.channel,
    category: c.category ?? "",
    details: c.details ?? "",
    bookingReference: c.booking?.reference ?? "",
    handledByUserId: c.handledByUserId ?? "",
    receivedAt: c.inputs?.receivedAt ?? "",
    bookingDateTime: c.inputs?.bookingDateTime ?? "",
    complainantName: c.complainantName ?? "",
    complainantPhone: c.complainantPhone ?? "",
    complainantAddress: c.complainantAddress ?? "",
    driverName: c.driverName ?? "",
    vehicleReg: c.vehicleReg ?? "",
  };
}

/**
 * item = a record from GET /admin/complaints to update it; null to log a new one.
 * bookingId (new only) = start from that booking (the Bookings page's "Log complaint").
 */
export function ComplaintModal({
  item,
  bookingId,
  open,
  onClose,
}: {
  item: any | null;
  bookingId?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const creating = !item;
  const initial = useMemo(() => (item ? detailsOf(item) : EMPTY), [item]);
  const [d, setD] = useState<Details>(initial);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(creating);
  const [status, setStatus] = useState<string>(item?.status ?? "RECEIVED");
  const [outcome, setOutcome] = useState<string>(item?.outcome ?? "");
  const [resolution, setResolution] = useState<string>(item?.resolutionNote ?? "");
  const [representative, setRepresentative] = useState<string>(item?.representativeName ?? "");
  const [note, setNote] = useState("");
  const [noteAt, setNoteAt] = useState("");

  useEffect(() => {
    if (!open) return;
    setD(initial);
    setError("");
    setShowDetails(creating);
    setStatus(item?.status ?? "RECEIVED");
    setOutcome(item?.outcome ?? "");
    setResolution(item?.resolutionNote ?? "");
    setRepresentative(item?.representativeName ?? "");
    setNote("");
    setNoteAt("");
  }, [open, item, initial, creating]);

  const { data: staff = [] } = useQuery<any[]>({
    queryKey: ["staff"],
    queryFn: () => api.get("/admin/staff").then((r) => r.data.data),
    enabled: open,
  });
  const fromBooking = useQuery<any>({
    queryKey: ["booking", bookingId],
    queryFn: () => api.get(`/admin/bookings/${bookingId}`).then((r) => r.data.data),
    enabled: open && creating && !!bookingId,
  });
  useEffect(() => {
    const b = fromBooking.data;
    if (b && open && creating) setD((x) => ({ ...x, bookingReference: b.reference ?? "" }));
  }, [fromBooking.data, open, creating]);

  const set = (k: keyof Details) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const type = d.type;
  const compliment = type === "COMPLIMENT";
  const statusChanged = !!item && status !== item.status;
  const resolving = status === "RESOLVED";
  const closingCompliment = compliment && status === "CLOSED";
  const fromApp = item?.channel === "APP" && !!item?.bookingId;
  const passengerLinked = !!item?.passengerId;

  function detailsPayload() {
    const out: Record<string, string | null> = {};
    (Object.keys(EMPTY) as (keyof Details)[]).forEach((k) => {
      if (d[k] !== initial[k]) out[k] = d[k].trim() === "" ? null : d[k];
    });
    if (creating) {
      out.type = d.type;
      out.channel = d.channel;
      if (bookingId && d.bookingReference === fromBooking.data?.reference) {
        delete out.bookingReference;
        out.bookingId = bookingId;
      }
    }
    return out;
  }

  const save = useMutation({
    mutationFn: async () => {
      if (creating) return api.post("/admin/complaints", { ...detailsPayload(), note: note.trim() || null });
      const details = detailsPayload();
      const body: Record<string, any> = {};
      if (Object.keys(details).length) body.details = details;
      if (note.trim()) {
        body.note = note.trim();
        body.noteAt = noteAt || null;
      }
      if (statusChanged) body.status = status;
      const resultChanged =
        isDone(item.status) &&
        !statusChanged &&
        (outcome !== (item.outcome ?? "") || resolution !== (item.resolutionNote ?? "") || representative !== (item.representativeName ?? ""));
      if ((statusChanged && isDone(status)) || resultChanged) {
        if (!compliment) body.outcome = outcome || null;
        body.resolutionNote = resolution.trim() || null;
        body.representativeName = representative.trim() || null;
      }
      if (!Object.keys(body).length) return null;
      return api.put(`/admin/complaints/${item.id}`, body);
    },
    onSuccess: (r) => {
      refreshComplaints(qc);
      if (r) toast.success(creating ? `Logged ${r.data.data.refNo}` : `${item.refNo} updated`);
      onClose();
    },
    onError: (err: any) => setError(errorText(err, "Could not save")),
  });

  const label = "text-xs text-slate-400 mb-1.5 block";
  const canSave = creating ? !!d.details.trim() : true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        creating ? (
          "Log complaint / compliment"
        ) : (
          <span>
            <span className="font-mono text-brand-400">{item.refNo}</span>{" "}
            <span className="text-xs text-slate-400">{item.typeLabel}</span>{" "}
            <span className={`text-xs ${CC_STATUS[item.status]?.color}`}>{CC_STATUS[item.status]?.label}</span>
          </span>
        )
      }
    >
      <div className="space-y-4">
        {!creating && (
          <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs space-y-1">
            {item.category && <p className="text-orange-400 font-semibold">{item.category}</p>}
            <p className="text-slate-300 whitespace-pre-line">{item.details}</p>
            <p className="text-slate-500">
              {item.booking?.reference && <span className="font-mono text-brand-400">{item.booking.reference} · </span>}
              {item.complainantName ?? "No name"}
              {item.complainantPhone ? ` · ${item.complainantPhone}` : ""}
              {item.driverName ? ` · driver ${item.driverName}` : ""}
              {` · via ${item.channelLabel?.toLowerCase()}`}
            </p>
            <a
              href={`/tfl-records?tab=complaints&complaint=${item.id}`}
              className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300"
            >
              TfL record <ExternalLink size={10} />
            </a>
          </div>
        )}

        {creating && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className={label}>This is a</span>
              <div className="flex gap-2">
                {[
                  { v: "COMPLAINT", t: "Complaint" },
                  { v: "COMPLIMENT", t: "Compliment" },
                ].map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setD((x) => ({ ...x, type: o.v }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      type === o.v ? "bg-brand-500 text-black border-brand-500" : "border-[var(--border)] text-slate-300 hover:border-brand-500"
                    }`}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label} htmlFor="cc-channel">Received by</label>
              <select id="cc-channel" className="input w-full" value={d.channel} onChange={set("channel")}>
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {fromBooking.data && (
              <p className="sm:col-span-2 text-[11px] text-slate-500">
                From booking <span className="font-mono text-brand-400">{fromBooking.data.reference}</span> — the booking time,
                passenger, driver and vehicle are copied from it.
              </p>
            )}
          </div>
        )}

        {!creating && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="cc-status">Status</label>
              <select id="cc-status" className="input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES_FOR[type].map((s) => (
                  <option key={s} value={s}>{CC_STATUS[s].label}</option>
                ))}
              </select>
            </div>
            {resolving && (
              <div>
                <label className={label} htmlFor="cc-outcome">
                  Outcome <span className="text-red-400">*</span>
                </label>
                <select id="cc-outcome" className="input w-full" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="">Choose…</option>
                  {CC_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            {(resolving || closingCompliment) && (
              <>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="cc-resolution">
                    {compliment ? "What was done (optional)" : <>Resolution <span className="text-red-400">*</span></>}
                  </label>
                  <textarea
                    id="cc-resolution"
                    className="input w-full resize-none text-sm"
                    rows={2}
                    placeholder={compliment ? "e.g. Passed to the driver" : "e.g. We've spoken to the driver and refunded £5. Sorry for the delay."}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                  />
                  {!compliment && passengerLinked && (
                    <p className="text-[10px] text-slate-500 mt-1">The passenger sees this in the app and gets a notification.</p>
                  )}
                </div>
                <div>
                  <label className={label} htmlFor="cc-rep">Company representative</label>
                  <input id="cc-rep" className="input w-full" placeholder="You" value={representative} onChange={(e) => setRepresentative(e.target.value)} />
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <label className={label} htmlFor="cc-note">
            {creating ? "First note (optional)" : "Add to the history — method / enquiry to resolve"}
          </label>
          <textarea
            id="cc-note"
            className="input w-full resize-none text-sm"
            rows={2}
            placeholder="e.g. Called the passenger · Checked the trip GPS · Spoke to the driver"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {!creating && (
            <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-1.5">
              When
              <input type="datetime-local" className="input py-1 text-xs" value={noteAt} onChange={(e) => setNoteAt(e.target.value)} />
              <span className="text-slate-500 whitespace-nowrap">empty = now</span>
            </label>
          )}
        </div>

        {!creating && item.contacts?.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] max-h-48 overflow-y-auto">
            {item.contacts.map((c: any) => (
              <div key={c.id} className="px-3 py-2 text-xs">
                <span className="text-slate-500">{ukDateTime(c.at)} · {c.staffName}</span>
                <p className="text-slate-300 mt-0.5 whitespace-pre-line">{c.note}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-slate-300"
          >
            TfL record details
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 pt-0">
              {!compliment && (
                <div>
                  <label className={label} htmlFor="cc-cat">Category</label>
                  <select id="cc-cat" className="input w-full" value={d.category} onChange={set("category")}>
                    <option value="">—</option>
                    {[...CATEGORIES, ...(d.category && !CATEGORIES.includes(d.category) ? [d.category] : [])].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={label} htmlFor="cc-handled">Handled by</label>
                <select id="cc-handled" className="input w-full" value={d.handledByUserId} onChange={set("handledByUserId")}>
                  <option value="">{creating ? "Me" : "—"}</option>
                  {staff.map((u: any) => (
                    <option key={u.id} value={u.id}>{`${u.firstName} ${u.lastName ?? ""}`.trim()}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="cc-details">
                  Details of {compliment ? "compliment" : "complaint"} {creating && <span className="text-red-400">*</span>}
                </label>
                <textarea id="cc-details" className="input w-full resize-none text-sm" rows={3} value={d.details} onChange={set("details")} />
              </div>
              <div>
                <label className={label} htmlFor="cc-booking">Booking reference</label>
                <input
                  id="cc-booking"
                  className="input w-full font-mono uppercase"
                  placeholder="DSM…"
                  value={d.bookingReference}
                  onChange={set("bookingReference")}
                  disabled={fromApp}
                  title={fromApp ? "A complaint made in the app stays on its booking" : undefined}
                />
                <p className="text-[10px] text-slate-500 mt-1">Fills in the booking time, passenger, driver and vehicle</p>
              </div>
              <div>
                <label className={label} htmlFor="cc-received">Date received</label>
                <input id="cc-received" type="datetime-local" className="input w-full" value={d.receivedAt} onChange={set("receivedAt")} />
                {creating && <p className="text-[10px] text-slate-500 mt-1">Empty = now</p>}
              </div>
              <div>
                <label className={label} htmlFor="cc-booking-at">Date and time of booking</label>
                <input id="cc-booking-at" type="datetime-local" className="input w-full" value={d.bookingDateTime} onChange={set("bookingDateTime")} />
              </div>
              <div>
                <label className={label} htmlFor="cc-name">{compliment ? "From (name)" : "Complainant name"}</label>
                <input id="cc-name" className="input w-full" value={d.complainantName} onChange={set("complainantName")} />
              </div>
              <div>
                <label className={label} htmlFor="cc-phone">Phone</label>
                <input id="cc-phone" className="input w-full" value={d.complainantPhone} onChange={set("complainantPhone")} />
              </div>
              <div>
                <label className={label} htmlFor="cc-driver">Driver</label>
                <input id="cc-driver" className="input w-full" value={d.driverName} onChange={set("driverName")} />
              </div>
              <div>
                <label className={label} htmlFor="cc-reg">Vehicle registration</label>
                <input id="cc-reg" className="input w-full font-mono uppercase" value={d.vehicleReg} onChange={set("vehicleReg")} />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="cc-addr">Address (one line per row)</label>
                <textarea id="cc-addr" className="input w-full resize-none text-sm" rows={3} value={d.complainantAddress} onChange={set("complainantAddress")} />
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 btn-ghost py-2.5 text-sm">
            Cancel
          </button>
          <button
            onClick={() => {
              setError("");
              if (!creating && statusChanged && resolving && (!outcome || !resolution.trim()))
                return setError("Choose the outcome and write the resolution before resolving");
              save.mutate();
            }}
            disabled={!canSave || save.isPending}
            className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : creating ? "Log" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
