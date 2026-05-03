"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { SectionHeader, Table, Modal, Spinner } from "@/components/ui";
import {
  Plus,
  Mail,
  Phone,
  MapPin,
  Clock,
  Users,
  BookOpen,
  Archive,
  RotateCcw,
  Heart,
  FileText,
  Repeat2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";

const MOBILITY_LABELS: Record<string, string> = {
  AMBULATORY: "Ambulatory",
  WALKING_AID: "Walking Aid",
  WHEELCHAIR: "Wheelchair",
  WHEELCHAIR_ASSIST: "W/C Assist",
  STRETCHER: "Stretcher",
};

export default function CareHomePage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [confirmAction, setConfirmAction] = useState<
    "suspend" | "reactivate" | "archive" | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "residents" | "bookings" | "invoices" | "recurring"
  >("residents");

  const { data, isLoading } = useQuery({
    queryKey: ["carehome"],
    queryFn: () => api.get("/admin/carehome").then((r: any) => r.data),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["carehome", selected?.id],
    queryFn: () =>
      api.get(`/admin/carehome/${selected.id}`).then((r: any) => r.data),
    enabled: !!selected?.id,
  });

  const { register, handleSubmit, reset } = useForm();

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/admin/carehome", data),
    onSuccess: () => {
      toast.success("Care home account created");
      qc.invalidateQueries({ queryKey: ["carehome"] });
      setCreating(false);
      reset();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to create account"),
  });

  const doAction = async () => {
    if (!selected || !confirmAction) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/carehome/${selected.id}/${confirmAction}`);
      toast.success(`Account ${confirmAction}d`);
      setConfirmAction(null);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["carehome"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const accounts: any[] = data ?? [];
  const detail = detailData;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Care Home Accounts"
        subtitle={`${accounts.length} accounts`}
        action={
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> Add Care Home
          </button>
        }
      />

      {/* ─── Accounts table ─────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Care Home",
              "Contact",
              "Email",
              "Payment Terms",
              "Residents",
              "Bookings",
              "Status",
            ]}
            isEmpty={!accounts.length}
            emptyMessage="No care home accounts yet"
          >
            {accounts.map((a: any) => (
              <tr
                key={a.id}
                className="table-row cursor-pointer"
                onClick={() => {
                  setSelected(a);
                  setActiveTab("residents");
                }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-400">
                      <Heart size={14} />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">{a.name}</p>
                      <p className="text-[10px] text-slate-500 truncate max-w-[160px]">
                        {a.address}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {a.contactName}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {a.contactEmail}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {a.paymentTermsDays} days
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {a._count?.residents ?? 0}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {a._count?.bookings ?? 0}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      a.status === "ACTIVE"
                        ? "bg-green-500/20 text-green-400"
                        : a.status === "SUSPENDED"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-slate-500/20 text-slate-400"
                    }`}
                  >
                    {a.status}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ─── Detail modal ───────────────────────────────────────────────────── */}
      <Modal
        open={!!selected && !confirmAction}
        onClose={() => setSelected(null)}
        title={selected?.name ?? "Care Home"}
      >
        {selected && (
          <div className="space-y-4">
            {/* Account info */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <MapPin size={13} className="text-slate-500 shrink-0" />
                <span className="truncate">{selected.address}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Phone size={13} className="text-slate-500 shrink-0" />
                {selected.contactPhone}
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Mail size={13} className="text-slate-500 shrink-0" />
                {selected.contactEmail}
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Mail size={13} className="text-slate-500 shrink-0" />
                <span className="truncate">
                  {selected.invoicingEmail} (invoicing)
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Clock size={13} className="text-slate-500 shrink-0" />
                {selected.paymentTermsDays} day payment terms
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    selected.status === "ACTIVE"
                      ? "bg-green-500/20 text-green-400"
                      : selected.status === "SUSPENDED"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-slate-500/20 text-slate-400"
                  }`}
                >
                  {selected.status}
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-[var(--border)] pb-0">
              {(
                ["residents", "bookings", "invoices", "recurring"] as const
              ).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-t-lg capitalize transition-colors ${
                    activeTab === tab
                      ? "bg-brand-500/10 text-brand-400 border border-b-0 border-brand-500/30"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tab === "residents" && <Users size={11} />}
                  {tab === "bookings" && <BookOpen size={11} />}
                  {tab === "invoices" && <FileText size={11} />}
                  {tab === "recurring" && <Repeat2 size={11} />}
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="min-h-[120px]">
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner size={20} />
                </div>
              ) : activeTab === "residents" ? (
                <div className="space-y-1.5">
                  {detail?.residents?.length === 0 && (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      No residents yet
                    </p>
                  )}
                  {detail?.residents?.map((r: any) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--table-hover)]"
                    >
                      <div>
                        <p className="text-xs font-medium text-white">
                          {r.name}
                        </p>
                        {r.accessNotes && (
                          <p className="text-[10px] text-slate-500">
                            {r.accessNotes}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-400">
                        {MOBILITY_LABELS[r.mobility] ?? r.mobility}
                      </span>
                    </div>
                  ))}
                </div>
              ) : activeTab === "bookings" ? (
                <div className="space-y-1.5">
                  {detail?.bookings?.length === 0 || !detail?.bookings ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      No bookings yet
                    </p>
                  ) : (
                    detail.bookings.slice(0, 8).map((b: any) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--table-hover)]"
                      >
                        <div>
                          <p className="text-xs font-medium text-white">
                            {b.resident?.name ?? "—"}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate max-w-[220px]">
                            {b.pickupAddress} → {b.dropoffAddress}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-medium text-brand-400">
                            £{b.estimatedFare?.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {b.status}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : activeTab === "invoices" ? (
                <div className="space-y-1.5">
                  {detail?.invoices?.length === 0 || !detail?.invoices ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      No invoices yet
                    </p>
                  ) : (
                    detail.invoices.map((inv: any) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--table-hover)]"
                      >
                        <div>
                          <p className="text-xs font-medium text-white">
                            {new Date(inv.periodFrom).toLocaleDateString(
                              "en-GB",
                              { day: "numeric", month: "short" }
                            )}{" "}
                            –{" "}
                            {new Date(inv.periodTo).toLocaleDateString(
                              "en-GB",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Due{" "}
                            {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-white">
                            £{inv.totalAmount.toFixed(2)}
                          </p>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              inv.isPaid
                                ? "bg-green-500/20 text-green-400"
                                : "bg-yellow-500/20 text-yellow-400"
                            }`}
                          >
                            {inv.isPaid ? "Paid" : "Outstanding"}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {detail?.recurringBookings?.length === 0 ||
                  !detail?.recurringBookings ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      No recurring schedules yet
                    </p>
                  ) : (
                    detail.recurringBookings.map((r: any) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--table-hover)]"
                      >
                        <div>
                          <p className="text-xs font-medium text-white">
                            {r.resident?.name}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {r.pattern} at {r.scheduledTime}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            r.isActive
                              ? "bg-green-500/20 text-green-400"
                              : "bg-slate-500/20 text-slate-400"
                          }`}
                        >
                          {r.isActive ? "Active" : "Paused"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div
              className="flex gap-2 pt-2 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              {selected.status === "ACTIVE" ? (
                <button
                  onClick={() => setConfirmAction("suspend")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-yellow-400 transition-colors px-3 py-2 rounded-lg border border-[var(--border)] hover:border-yellow-500/30"
                >
                  <Archive size={13} /> Suspend
                </button>
              ) : selected.status === "SUSPENDED" ? (
                <button
                  onClick={() => setConfirmAction("reactivate")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-green-400 transition-colors px-3 py-2 rounded-lg border border-[var(--border)] hover:border-green-500/30"
                >
                  <RotateCcw size={13} /> Reactivate
                </button>
              ) : null}
              {selected.status !== "ARCHIVED" && (
                <button
                  onClick={() => setConfirmAction("archive")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-3 py-2 rounded-lg border border-[var(--border)]"
                >
                  <Archive size={13} /> Archive
                </button>
              )}
              {selected.status === "ARCHIVED" && (
                <button
                  onClick={() => setConfirmAction("reactivate")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-green-400 transition-colors px-3 py-2 rounded-lg border border-[var(--border)] hover:border-green-500/30"
                >
                  <RotateCcw size={13} /> Reactivate
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Confirm action modal ────────────────────────────────────────────── */}
      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction === "suspend"
            ? "Suspend Account"
            : confirmAction === "reactivate"
            ? "Reactivate Account"
            : "Archive Account"
        }
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {confirmAction === "suspend" &&
              `Suspend ${selected?.name}? Staff portal access will be blocked.`}
            {confirmAction === "reactivate" &&
              `Reactivate ${selected?.name}? Portal access will be restored.`}
            {confirmAction === "archive" &&
              `Archive ${selected?.name}? This will suspend their access.`}
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setConfirmAction(null)}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
            <button
              onClick={doAction}
              disabled={actionLoading}
              className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50 transition-all ${
                confirmAction === "reactivate"
                  ? "bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20"
                  : "bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20"
              }`}
            >
              {actionLoading ? <Spinner size={14} /> : null}
              {confirmAction === "suspend"
                ? "Suspend"
                : confirmAction === "reactivate"
                ? "Reactivate"
                : "Archive"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Create modal ────────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
          reset();
        }}
        title="New Care Home Account"
      >
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "name", label: "Care Home Name", full: true },
              { name: "address", label: "Address", full: true },
              { name: "contactName", label: "Contact Name" },
              { name: "contactPhone", label: "Contact Phone" },
              { name: "contactEmail", label: "Contact Email", type: "email" },
              {
                name: "invoicingEmail",
                label: "Invoicing Email",
                type: "email",
              },
              {
                name: "paymentTermsDays",
                label: "Payment Terms (days)",
                type: "number",
              },
            ].map(({ name, label, type = "text", full }: any) => (
              <div key={name} className={full ? "col-span-2" : ""}>
                <label className="text-xs text-slate-400 block mb-1">
                  {label}
                </label>
                <input
                  type={type}
                  {...register(name, { required: true })}
                  className="input"
                  placeholder={label}
                  defaultValue={name === "paymentTermsDays" ? 30 : undefined}
                />
              </div>
            ))}
          </div>

          <div className="col-span-2 pt-2 border-t border-[var(--border)]">
            <p className="text-xs font-semibold text-white mb-1">
              Initial Staff Login
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              Create the first staff member who can log into the care home
              portal.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "staffName", label: "Staff Name", full: true },
              { name: "staffEmail", label: "Staff Email", type: "email" },
              { name: "staffPassword", label: "Password", type: "password" },
              { name: "staffPhone", label: "Staff Phone" },
            ].map(({ name, label, type = "text", full }: any) => (
              <div key={name} className={full ? "col-span-2" : ""}>
                <label className="text-xs text-slate-400 block mb-1">
                  {label}
                </label>
                <input
                  type={type}
                  {...register(name, { required: name !== "staffPhone" })}
                  className="input"
                  placeholder={label}
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn-primary w-full mt-2"
          >
            {createMutation.isPending
              ? "Creating…"
              : "Create Care Home Account"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
