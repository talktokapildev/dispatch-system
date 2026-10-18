"use client";
// admin/src/components/LostProperty.tsx
//
// Lost property (TfL Condition 9): the modal used on Alerts to log an item handed in / phoned
// in, and to update one — status and result, a new history entry ("Method/Enquiry to return
// property", optionally shown to the passenger in the app), and the TfL record details.
// API: POST /admin/lost-property, PUT /admin/lost-property/:id.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { Modal } from "@/components/ui";

export const LP_STATUS: Record<string, { label: string; color: string }> = {
  REPORTED: { label: "Reported", color: "text-amber-400" },
  FOUND: { label: "Found", color: "text-blue-400" },
  RETURNED: { label: "Returned", color: "text-green-400" },
  CLOSED: { label: "Closed", color: "text-slate-400" },
};
export const LP_OUTCOMES: { value: string; label: string; returned: boolean }[] = [
  { value: "COLLECTED_BY_OWNER", label: "Collected by owner", returned: true },
  { value: "POSTED_TO_OWNER", label: "Posted / couriered to owner", returned: true },
  { value: "RETURNED_BY_DRIVER", label: "Returned by driver", returned: true },
  { value: "HANDED_TO_POLICE", label: "Handed to police", returned: false },
  { value: "DISPOSED", label: "Disposed of", returned: false },
  { value: "DONATED", label: "Donated", returned: false },
];
const isClosed = (s: string) => s === "RETURNED" || s === "CLOSED";
const errorText = (err: any, fallback: string) => err?.response?.data?.error ?? fallback;

/** Keys every Alerts / TfL Records query uses, refreshed after any change. */
export function refreshLostProperty(qc: ReturnType<typeof useQueryClient>) {
  ["lost-property", "tfl-lost-property", "tfl-lost-property-register"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

type Details = {
  bookingReference: string;
  description: string;
  handedInByDriverId: string;
  handedInByName: string;
  vehicleReg: string;
  receivedAt: string;
  bookingDateTime: string;
  customerName: string;
  customerAddress: string;
  contactPhone: string;
};

const EMPTY: Details = {
  bookingReference: "",
  description: "",
  handedInByDriverId: "",
  handedInByName: "",
  vehicleReg: "",
  receivedAt: "",
  bookingDateTime: "",
  customerName: "",
  customerAddress: "",
  contactPhone: "",
};

function detailsOf(item: any): Details {
  return {
    bookingReference: item.booking?.reference ?? "",
    description: item.description ?? "",
    handedInByDriverId: item.handedInByDriverId ?? "",
    handedInByName: item.handedInByDriverId ? "" : item.handedInByName ?? "",
    vehicleReg: item.vehicleReg ?? "",
    receivedAt: item.inputs?.receivedAt ?? "",
    bookingDateTime: item.inputs?.bookingDateTime ?? "",
    customerName: item.customerName ?? "",
    customerAddress: item.customerAddress ?? "",
    contactPhone: item.contactPhone ?? "",
  };
}

const OTHER = "__other";

/**
 * item = an item from GET /admin/lost-property to update it; null to log a new one.
 * bookingId (new only) = start from that booking (the Bookings page's "Log lost property").
 */
export function LostPropertyModal({
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
  // new item
  const [missing, setMissing] = useState(false);
  // update
  const [status, setStatus] = useState<string>(item?.status ?? "FOUND");
  const [outcome, setOutcome] = useState<string>(item?.outcome ?? "");
  const [outcomeAt, setOutcomeAt] = useState<string>(item?.inputs?.outcomeAt ?? "");
  const [outcomeDetails, setOutcomeDetails] = useState<string>(item?.outcomeDetails ?? "");
  const [representative, setRepresentative] = useState<string>(item?.representativeName ?? "");
  const [note, setNote] = useState("");
  const [noteAt, setNoteAt] = useState("");
  const [showToPassenger, setShowToPassenger] = useState(false);

  useEffect(() => {
    if (!open) return;
    setD(initial);
    setError("");
    setShowDetails(creating);
    setMissing(false);
    setStatus(item?.status ?? "FOUND");
    setOutcome(item?.outcome ?? "");
    setOutcomeAt(item?.inputs?.outcomeAt ?? "");
    setOutcomeDetails(item?.outcomeDetails ?? "");
    setRepresentative(item?.representativeName ?? "");
    setNote("");
    setNoteAt("");
    setShowToPassenger(false);
  }, [open, item, initial, creating]);

  const { data: drivers = [] } = useQuery<any[]>({
    queryKey: ["tfl-record-drivers"],
    queryFn: () => api.get("/admin/tfl-records/drivers").then((r) => r.data.data),
    enabled: open,
  });

  // Starting from a booking: show it, and preselect its driver as "handed in by"
  const fromBooking = useQuery<any>({
    queryKey: ["booking", bookingId],
    queryFn: () => api.get(`/admin/bookings/${bookingId}`).then((r) => r.data.data),
    enabled: open && creating && !!bookingId,
  });
  useEffect(() => {
    const b = fromBooking.data;
    if (!b || !open || !creating) return;
    setD((x) => ({
      ...x,
      bookingReference: b.reference ?? "",
      handedInByDriverId: x.handedInByDriverId || b.driverId || "",
    }));
  }, [fromBooking.data, open, creating]);

  const set = (k: keyof Details) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const handedValue = d.handedInByDriverId || (d.handedInByName ? OTHER : "");
  const [otherHanded, setOtherHanded] = useState(false);
  useEffect(() => setOtherHanded(!!(open && !initial.handedInByDriverId && initial.handedInByName)), [open, initial]);

  const closing = isClosed(status);
  const statusChanged = !!item && status !== item.status;
  const outcomeChoices = LP_OUTCOMES.filter((o) => status !== "RETURNED" || o.returned);
  const passengerLinked = !!item?.passengerId || (creating && !!fromBooking.data?.passengerId);
  const fromPassenger = item?.source === "PASSENGER_REPORT";

  /** Details that changed (update) or were filled in (new): "" → null. */
  function detailsPayload() {
    const out: Record<string, string | null> = {};
    (Object.keys(EMPTY) as (keyof Details)[]).forEach((k) => {
      if (d[k] !== initial[k]) out[k] = d[k].trim() === "" ? null : d[k];
    });
    if (creating && bookingId && d.bookingReference === fromBooking.data?.reference) {
      delete out.bookingReference;
      out.bookingId = bookingId;
    }
    if ("handedInByDriverId" in out || "handedInByName" in out) {
      out.handedInByDriverId = d.handedInByDriverId || null;
      out.handedInByName = d.handedInByDriverId ? null : d.handedInByName.trim() || null;
    }
    return out;
  }

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        return api.post("/admin/lost-property", {
          ...detailsPayload(),
          status: missing ? "REPORTED" : "FOUND",
          note: note.trim() || null,
          showToPassenger: passengerLinked && showToPassenger,
        });
      }
      const details = detailsPayload();
      const body: Record<string, any> = {};
      if (Object.keys(details).length) body.details = details;
      if (note.trim()) {
        body.note = note.trim();
        body.noteAt = noteAt || null;
        body.showToPassenger = passengerLinked && showToPassenger;
      }
      if (statusChanged) body.status = status;
      const outcomeChanged =
        isClosed(item.status) &&
        !statusChanged &&
        (outcome !== (item.outcome ?? "") ||
          outcomeAt !== (item.inputs?.outcomeAt ?? "") ||
          outcomeDetails !== (item.outcomeDetails ?? "") ||
          representative !== (item.representativeName ?? ""));
      if ((statusChanged && closing) || outcomeChanged) {
        body.outcome = outcome || null;
        body.outcomeAt = outcomeAt || null;
        body.outcomeDetails = outcomeDetails.trim() || null;
        body.representativeName = representative.trim() || null;
      }
      if (!Object.keys(body).length) return null;
      return api.put(`/admin/lost-property/${item.id}`, body);
    },
    onSuccess: (r) => {
      refreshLostProperty(qc);
      if (r) toast.success(creating ? `Logged ${r.data.data.refNo}` : `${item.refNo} updated`);
      onClose();
    },
    onError: (err: any) => setError(errorText(err, "Could not save")),
  });

  const canSave = creating ? !!d.description.trim() : true;
  const label = "text-xs text-slate-400 mb-1.5 block";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        creating ? (
          "Log lost property"
        ) : (
          <span>
            <span className="font-mono text-brand-400">{item.refNo}</span>{" "}
            <span className={`text-xs ${LP_STATUS[item.status]?.color}`}>{LP_STATUS[item.status]?.label}</span>
          </span>
        )
      }
    >
      <div className="space-y-4">
        {!creating && (
          <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs space-y-1">
            <p className="text-slate-300">{item.description}</p>
            <p className="text-slate-500">
              {item.booking?.reference && <span className="font-mono text-brand-400">{item.booking.reference} · </span>}
              {item.customerName ?? "No customer"}
              {item.contactPhone ? ` · ${item.contactPhone}` : ""}
              {item.vehicleReg ? ` · ${item.vehicleReg}` : ""}
            </p>
            <a
              href={`/tfl-records?tab=lost-property&item=${item.id}`}
              className="inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300"
            >
              TfL record <ExternalLink size={10} />
            </a>
          </div>
        )}

        {creating && (
          <div>
            <span className={label}>The item is</span>
            <div className="flex gap-2">
              {[
                { v: false, t: "Found / handed in" },
                { v: true, t: "Reported missing (not found yet)" },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => setMissing(o.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    missing === o.v ? "bg-brand-500 text-black border-brand-500" : "border-[var(--border)] text-slate-300 hover:border-brand-500"
                  }`}
                >
                  {o.t}
                </button>
              ))}
            </div>
            {fromBooking.data && (
              <p className="text-[11px] text-slate-500 mt-2">
                From booking <span className="font-mono text-brand-400">{fromBooking.data.reference}</span> — the vehicle,
                booking time and customer are copied from it.
              </p>
            )}
          </div>
        )}

        {!creating && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="lp-status">Status</label>
              <select id="lp-status" className="input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(LP_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            {closing && (
              <div>
                <label className={label} htmlFor="lp-outcome">
                  Result <span className="text-red-400">*</span>
                </label>
                <select id="lp-outcome" className="input w-full" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="">Choose…</option>
                  {outcomeChoices.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
            {closing && (
              <>
                <div>
                  <label className={label} htmlFor="lp-outcome-at">Date of result</label>
                  <input id="lp-outcome-at" type="datetime-local" className="input w-full" value={outcomeAt} onChange={(e) => setOutcomeAt(e.target.value)} />
                  <p className="text-[10px] text-slate-500 mt-1">Empty = now</p>
                </div>
                <div>
                  <label className={label} htmlFor="lp-rep">Company representative</label>
                  <input id="lp-rep" className="input w-full" placeholder="You" value={representative} onChange={(e) => setRepresentative(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="lp-outcome-details">Result details</label>
                  <textarea
                    id="lp-outcome-details"
                    className="input w-full resize-none text-sm"
                    rows={2}
                    placeholder="e.g. Collected by owner from the office, ID checked · Handed to Crawley police, ref 1234"
                    value={outcomeDetails}
                    onChange={(e) => setOutcomeDetails(e.target.value)}
                  />
                </div>
              </>
            )}
            {status === "RETURNED" && (
              <p className="sm:col-span-2 text-[11px] text-slate-500">
                &quot;Returned&quot; is for items the owner got back. For police, disposal or donation choose &quot;Closed&quot;.
              </p>
            )}
          </div>
        )}

        <div>
          <label className={label} htmlFor="lp-note">
            {creating ? "First note (optional)" : "Add to the history — method / enquiry to return the property"}
          </label>
          <textarea
            id="lp-note"
            className="input w-full resize-none text-sm"
            rows={2}
            placeholder="e.g. Called the passenger, no answer · Driver has it, owner collecting Tuesday"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-1.5">
            {!creating && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                When
                <input type="datetime-local" className="input py-1 text-xs" value={noteAt} onChange={(e) => setNoteAt(e.target.value)} />
                <span className="text-slate-500 whitespace-nowrap">empty = now</span>
              </label>
            )}
            {passengerLinked && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <input type="checkbox" checked={showToPassenger} onChange={(e) => setShowToPassenger(e.target.checked)} />
                Also show to the passenger in the app
              </label>
            )}
          </div>
        </div>

        {!creating && item.contacts?.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] max-h-48 overflow-y-auto">
            {item.contacts.map((c: any) => (
              <div key={c.id} className="px-3 py-2 text-xs">
                <span className="text-slate-500">{ukDateTime(c.at)} · {c.staffName}</span>
                {c.shownToPassenger && <span className="ml-2 text-[10px] text-blue-400">shown to passenger</span>}
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
              <div className="sm:col-span-2">
                <label className={label} htmlFor="lp-desc">
                  Details of property {creating && <span className="text-red-400">*</span>}
                </label>
                <textarea id="lp-desc" className="input w-full resize-none text-sm" rows={2} placeholder="e.g. Black iPhone 14 in a blue case, rear seat" value={d.description} onChange={set("description")} />
              </div>
              <div>
                <label className={label} htmlFor="lp-booking">Booking reference</label>
                <input
                  id="lp-booking"
                  className="input w-full font-mono uppercase"
                  placeholder="DSM…"
                  value={d.bookingReference}
                  onChange={set("bookingReference")}
                  disabled={fromPassenger}
                  title={fromPassenger ? "A passenger's report stays on the booking it was made on" : undefined}
                />
                <p className="text-[10px] text-slate-500 mt-1">Fills in the vehicle, booking time and customer</p>
              </div>
              <div>
                <label className={label} htmlFor="lp-handed">Handed in by</label>
                <select
                  id="lp-handed"
                  className="input w-full"
                  value={otherHanded ? OTHER : handedValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOtherHanded(v === OTHER);
                    setD((x) => ({ ...x, handedInByDriverId: v === OTHER ? "" : v, handedInByName: v === OTHER ? x.handedInByName : "" }));
                  }}
                >
                  <option value="">—</option>
                  {drivers.filter((x) => !x.left || x.id === d.handedInByDriverId).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.callSign ? ` (${x.callSign})` : ""}
                    </option>
                  ))}
                  <option value={OTHER}>Someone else…</option>
                </select>
                {otherHanded && (
                  <input className="input w-full mt-2" placeholder="Name, e.g. Gatwick South info desk" value={d.handedInByName} onChange={set("handedInByName")} />
                )}
              </div>
              <div>
                <label className={label} htmlFor="lp-reg">Vehicle registration (where found)</label>
                <input id="lp-reg" className="input w-full font-mono uppercase" value={d.vehicleReg} onChange={set("vehicleReg")} />
              </div>
              <div>
                <label className={label} htmlFor="lp-received">Date property received</label>
                <input id="lp-received" type="datetime-local" className="input w-full" value={d.receivedAt} onChange={set("receivedAt")} />
                {creating && !missing && <p className="text-[10px] text-slate-500 mt-1">Empty = now</p>}
              </div>
              <div>
                <label className={label} htmlFor="lp-booking-at">Date and time of booking</label>
                <input id="lp-booking-at" type="datetime-local" className="input w-full" value={d.bookingDateTime} onChange={set("bookingDateTime")} />
              </div>
              <div>
                <label className={label} htmlFor="lp-cust">Customer name</label>
                <input id="lp-cust" className="input w-full" value={d.customerName} onChange={set("customerName")} />
              </div>
              <div>
                <label className={label} htmlFor="lp-phone">Customer phone</label>
                <input id="lp-phone" className="input w-full" value={d.contactPhone} onChange={set("contactPhone")} />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="lp-addr">Customer address (one line per row)</label>
                <textarea id="lp-addr" className="input w-full resize-none text-sm" rows={3} value={d.customerAddress} onChange={set("customerAddress")} />
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
              if (!creating && closing && statusChanged && !outcome) return setError("Choose the result before closing this item");
              save.mutate();
            }}
            disabled={!canSave || save.isPending}
            className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : creating ? "Log item" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** "18 Oct 2026, 20:15" (UK). */
export function ukDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
