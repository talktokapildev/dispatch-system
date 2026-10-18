"use client";
// admin/src/components/DriverRegister.tsx
//
// TfL driver register on the driver detail: register details (call sign, middle names, address,
// post code, date of birth, NI number, DVLA licence check), periods of work (first available /
// leaving, restart / finish), and the Archive / Restore / Delete permanently dialogs.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, EyeOff, Pencil, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Modal, Spinner } from "@/components/ui";

/** "2026-10-18" → "18 Oct 2026" (calendar day, no time zone shift). */
export function dayText(key?: string | null): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Today in the UK as "YYYY-MM-DD". */
export function ukTodayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const errorText = (err: any, fallback: string) => err?.response?.data?.error ?? fallback;

export function useDriverRegister(driverId?: string | null) {
  return useQuery({
    queryKey: ["driver-register", driverId],
    queryFn: () => api.get(`/admin/drivers/${driverId}/register`).then((r) => r.data.data),
    enabled: !!driverId,
  });
}

function useRefresh(driverId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["driver-register", driverId] });
    qc.invalidateQueries({ queryKey: ["drivers"] });
    qc.invalidateQueries({ queryKey: ["vehicles"] });
  };
}

const box = "p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]";
const small = "text-[10px] text-slate-500 mb-1";

// ── Register details + periods ───────────────────────────────────────────────

export function DriverRegisterPanel({ driverId }: { driverId: string }) {
  const { data: reg, isLoading } = useDriverRegister(driverId);
  const refresh = useRefresh(driverId);
  const [editing, setEditing] = useState(false);
  const [showNi, setShowNi] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (payload: Record<string, string>) => api.put(`/admin/drivers/${driverId}/register`, payload),
    onSuccess: () => {
      toast.success("Register details saved");
      setEditing(false);
      setError("");
      refresh();
    },
    onError: (err: any) => setError(errorText(err, "Could not save")),
  });

  if (isLoading || !reg)
    return (
      <div className="flex justify-center py-4">
        <Spinner size={16} />
      </div>
    );

  const r = reg.register;
  const startEdit = () => {
    setForm({
      callSign: r.callSign ?? "",
      middleNames: r.middleNames ?? "",
      address: r.address ?? "",
      postcode: r.postcode ?? "",
      dateOfBirth: r.dateOfBirth ?? "",
      niNumber: r.niNumber ?? "",
      licenceCheckedAt: r.licenceCheckedAt ?? "",
    });
    setError("");
    setEditing(true);
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const w = reg.warnings;
  const warnings: string[] = [
    ...(w.missing.length ? [`Missing for the TfL register: ${w.missing.join(", ")}`] : []),
    ...(w.underAge ? [`Under ${21}: age ${w.age} (TfL minimum age for a PHV driver is 21)`] : []),
    ...(w.licenceCheckDue
      ? [
          r.licenceCheckedAt
            ? `DVLA licence last checked ${dayText(r.licenceCheckedAt)} — more than 6 months ago`
            : "DVLA licence check not recorded",
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-1">
          {warnings.map((t) => (
            <p key={t} className="text-xs text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {t}
            </p>
          ))}
        </div>
      )}

      {!editing ? (
        <div className={`${box} space-y-3`}>
          <div className="flex justify-end -mb-1">
            <button
              onClick={startEdit}
              className="flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300"
            >
              <Pencil size={11} /> Edit register details
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Call sign" value={r.callSign ?? "—"} mono />
            <Field label="Middle names" value={r.middleNames ?? "—"} />
            <div className="col-span-2">
              <p className={small}>Address</p>
              <p className="text-xs text-[var(--text)] whitespace-pre-line">{r.address ?? "—"}</p>
            </div>
            <Field label="Post code" value={r.postcode ?? "—"} mono />
            <Field
              label="Date of birth"
              value={r.dateOfBirth ? `${dayText(r.dateOfBirth)} (age ${w.age})` : "—"}
            />
            <div>
              <p className={small}>National Insurance No.</p>
              <p className="text-xs text-[var(--text)] font-mono flex items-center gap-2">
                {r.niNumber ? (showNi ? r.niNumber : r.niMasked) : "—"}
                {r.niNumber && (
                  <button
                    onClick={() => setShowNi((v) => !v)}
                    className="text-slate-500 hover:text-slate-300"
                    title={showNi ? "Hide" : "Show"}
                  >
                    {showNi ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                )}
              </p>
            </div>
            <Field label="DVLA licence last checked" value={dayText(r.licenceCheckedAt)} />
          </div>
        </div>
      ) : (
        <div className={`${box} space-y-3`}>
          <p className="text-[10px] text-slate-500">
            Make sure the address is the same on all the driver&apos;s documents.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Call sign" value={form.callSign} onChange={set("callSign")} placeholder="OR01" mono />
            <Input label="Middle names" value={form.middleNames} onChange={set("middleNames")} />
            <div className="col-span-2">
              <label className="text-xs text-slate-400 mb-1 block">Address</label>
              <textarea
                className="input w-full min-h-[72px]"
                value={form.address}
                onChange={set("address")}
                placeholder={"7 Riverside Walk\nCrawley\nWest Sussex"}
              />
            </div>
            <Input label="Post code" value={form.postcode} onChange={set("postcode")} placeholder="RH10 4SS" mono />
            <Input label="Date of birth" value={form.dateOfBirth} onChange={set("dateOfBirth")} type="date" />
            <Input
              label="National Insurance No."
              value={form.niNumber}
              onChange={set("niNumber")}
              placeholder="AB 12 34 56 C"
              mono
            />
            <Input
              label="DVLA licence last checked"
              value={form.licenceCheckedAt}
              onChange={set("licenceCheckedAt")}
              type="date"
              max={ukTodayKey()}
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost text-xs px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={() => save.mutate(form)}
              disabled={save.isPending}
              className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-black text-xs font-semibold"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <Periods reg={reg} driverId={driverId} />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className={small}>{label}</p>
      <p className={`text-xs text-[var(--text)] ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function Input({
  label,
  mono,
  ...props
}: { label: string; mono?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1 block">{label}</label>
      <input className={`input w-full ${mono ? "font-mono" : ""}`} {...props} />
    </div>
  );
}

// ── Periods (first available / leaving, restarts) ────────────────────────────

function Periods({ reg, driverId }: { reg: any; driverId: string }) {
  const refresh = useRefresh(driverId);
  const [edit, setEdit] = useState<any>(null);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (p: any) =>
      api.patch(`/admin/drivers/${driverId}/engagements/${p.id}`, {
        startedAt: p.startedAt,
        endedAt: p.endedAt || null,
        endReason: p.endReason || null,
        dismissedForConduct: !!p.dismissedForConduct,
        notes: p.notes || null,
      }),
    onSuccess: () => {
      toast.success("Dates updated");
      setEdit(null);
      setError("");
      refresh();
    },
    onError: (err: any) => setError(errorText(err, "Could not save the dates")),
  });

  return (
    <div className={box}>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-500">Availability (TfL register)</p>
        {reg.archived && reg.deletableFrom && (
          <p className="text-[10px] text-slate-500">
            Record kept until {dayText(reg.deletableFrom)}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        {reg.engagements.map((e: any, i: number) =>
          edit?.id === e.id ? (
            <div key={e.id} className="space-y-2 p-2 rounded-lg border border-brand-500/30">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label={i === 0 ? "Date first available" : "Restart date"}
                  type="date"
                  value={edit.startedAt ?? ""}
                  max={ukTodayKey()}
                  onChange={(ev) => setEdit({ ...edit, startedAt: ev.target.value })}
                />
                <Input
                  label={i === 0 ? "Date of leaving" : "Finish date"}
                  type="date"
                  value={edit.endedAt ?? ""}
                  max={ukTodayKey()}
                  disabled={!e.endedAt}
                  title={!e.endedAt ? "Use Archive when the driver leaves" : undefined}
                  onChange={(ev) => setEdit({ ...edit, endedAt: ev.target.value })}
                />
              </div>
              {e.endedAt && (
                <>
                  <Input
                    label="Reason for leaving"
                    value={edit.endReason ?? ""}
                    onChange={(ev) => setEdit({ ...edit, endReason: ev.target.value })}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={!!edit.dismissedForConduct}
                      onChange={(ev) => setEdit({ ...edit, dismissedForConduct: ev.target.checked })}
                    />
                    Dismissed for unsatisfactory conduct
                  </label>
                </>
              )}
              <Input label="Notes" value={edit.notes ?? ""} onChange={(ev) => setEdit({ ...edit, notes: ev.target.value })} />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setEdit(null)} className="btn-ghost text-xs px-2 py-1 flex items-center gap-1">
                  <X size={11} /> Cancel
                </button>
                <button
                  onClick={() => save.mutate(edit)}
                  disabled={save.isPending}
                  className="px-2 py-1 rounded-lg bg-brand-500 text-black text-xs font-semibold flex items-center gap-1"
                >
                  <Check size={11} /> Save
                </button>
              </div>
            </div>
          ) : (
            <div key={e.id} className="flex items-start justify-between gap-2 text-xs">
              <div>
                <p className="text-[var(--text)]">
                  <span className="text-slate-500">{i === 0 ? "First available" : "Restart"}</span>{" "}
                  {dayText(e.startedAt)}
                  <span className="text-slate-500"> → {i === 0 ? "Left" : "Finish"}</span>{" "}
                  {e.endedAt ? dayText(e.endedAt) : <span className="text-green-400">working</span>}
                </p>
                {(e.endReason || e.notes) && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {e.endReason}
                    {e.dismissedForConduct ? " · dismissed for conduct" : ""}
                    {e.endReason && e.notes ? " · " : ""}
                    {e.notes}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setEdit({ ...e });
                  setError("");
                }}
                className="text-slate-500 hover:text-brand-400 shrink-0"
                title="Correct dates"
              >
                <Pencil size={11} />
              </button>
            </div>
          )
        )}
        {!reg.engagements.length && <p className="text-xs text-slate-500">No dates recorded.</p>}
      </div>
    </div>
  );
}

// ── Archive (driver leaves) ──────────────────────────────────────────────────

export function ArchiveDriverModal({ driver, onClose, onDone }: { driver: any | null; onClose: () => void; onDone: () => void }) {
  const [leftOn, setLeftOn] = useState(ukTodayKey());
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const refresh = useRefresh(driver?.id ?? "");
  const archive = useMutation({
    mutationFn: () =>
      api.post(`/admin/drivers/${driver.id}/archive`, { leftOn, reason, dismissedForConduct: dismissed, notes: notes || null }),
    onSuccess: (res) => {
      const jobs: string[] = res.data.data.unassigned ?? [];
      toast.success(jobs.length ? `Driver archived · ${jobs.length} job(s) back on the job board` : "Driver archived");
      refresh();
      setReason("");
      setNotes("");
      setDismissed(false);
      setError("");
      onDone();
    },
    onError: (err: any) => setError(errorText(err, "Could not archive the driver")),
  });
  if (!driver) return null;
  return (
    <Modal open onClose={onClose} title={`Archive — ${driver.user.firstName} ${driver.user.lastName ?? ""}`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          The driver has left. They are taken offline and signed out, their accepted pre-booked jobs go back on the
          job board and their car is unassigned. Their records are kept for 12 months (TfL) and can then be deleted.
        </p>
        <Input label="Date of leaving" type="date" value={leftOn} max={ukTodayKey()} onChange={(e) => setLeftOn(e.target.value)} />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved away" />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={dismissed} onChange={(e) => setDismissed(e.target.checked)} />
          Dismissed for unsatisfactory conduct
        </label>
        {dismissed && (
          <p className="text-xs text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> TfL must be told within 14 days (driver&apos;s name and
            the circumstances). You&apos;ll get an ops SMS reminder.
          </p>
        )}
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={() => archive.mutate()}
            disabled={archive.isPending || !reason.trim()}
            className="btn-danger flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {archive.isPending && <Spinner size={14} />} Archive driver
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Restore (driver restarts) ────────────────────────────────────────────────

export function RestoreDriverModal({ driver, onClose, onDone }: { driver: any | null; onClose: () => void; onDone: () => void }) {
  const [restartOn, setRestartOn] = useState(ukTodayKey());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const refresh = useRefresh(driver?.id ?? "");
  const restore = useMutation({
    mutationFn: () => api.post(`/admin/drivers/${driver.id}/restore`, { restartOn, notes: notes || null }),
    onSuccess: () => {
      toast.success("Driver restored — check their documents and assign a car");
      refresh();
      setError("");
      setNotes("");
      onDone();
    },
    onError: (err: any) => setError(errorText(err, "Could not restore the driver")),
  });
  if (!driver) return null;
  return (
    <Modal open onClose={onClose} title={`Restore — ${driver.user.firstName} ${driver.user.lastName ?? ""}`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          The driver starts again: a new Restart date is added to their TfL record. They can sign in again; assign a car
          and check their documents before they take jobs. Their register details should be unchanged — update them if not.
        </p>
        <Input label="Restart date" type="date" value={restartOn} max={ukTodayKey()} onChange={(e) => setRestartOn(e.target.value)} />
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
            className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-black text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            {restore.isPending && <Spinner size={14} />} Restore driver
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Delete permanently (12 months after leaving) ─────────────────────────────

export function DeleteDriverModal({ driver, onClose, onDone }: { driver: any | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.delete(`/admin/drivers/${driver.id}`, { data: { confirmName: name } }),
    onSuccess: (res) => {
      const f = res.data.data;
      toast.success(
        f?.filesFailed ? `Driver deleted · ${f.filesFailed} file(s) could not be removed from storage` : "Driver deleted permanently"
      );
      qc.invalidateQueries({ queryKey: ["drivers"] });
      setName("");
      setError("");
      onDone();
    },
    onError: (err: any) => setError(errorText(err, "Could not delete the driver")),
  });
  if (!driver) return null;
  const fullName = `${driver.user.firstName} ${driver.user.lastName ?? ""}`.trim();
  return (
    <Modal open onClose={onClose} title="Delete driver permanently">
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Deletes {fullName}&apos;s account, register details, availability dates, documents (and the files), application
          and profile photo. Bookings stay, with their PHV licence number. Their car stays on the fleet. This can&apos;t be undone.
        </p>
        <Input label={`Type the driver's name to confirm: ${fullName}`} value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={() => del.mutate()}
            disabled={del.isPending || name.trim().toLowerCase() !== fullName.toLowerCase()}
            className="btn-danger flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {del.isPending && <Spinner size={14} />} Delete permanently
          </button>
        </div>
      </div>
    </Modal>
  );
}
