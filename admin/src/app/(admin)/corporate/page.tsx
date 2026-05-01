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
  CreditCard,
  Clock,
  Users,
  BookOpen,
  KeyRound,
  Archive,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";

export default function CorporatePage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [addingLogin, setAddingLogin] = useState(false);
  const [addLoginLoading, setAddLoginLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "archive" | "reactivate" | "delete" | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["corporate", showArchived],
    queryFn: () =>
      api
        .get(`/admin/corporate${showArchived ? "?archived=true" : ""}`)
        .then((r) => r.data.data),
  });

  const { register, handleSubmit, reset } = useForm();
  const {
    register: registerLogin,
    handleSubmit: handleLoginSubmit,
    reset: resetLogin,
  } = useForm();

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/admin/corporate", data),
    onSuccess: () => {
      toast.success("Corporate account created");
      qc.invalidateQueries({ queryKey: ["corporate"] });
      setCreating(false);
      reset();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to create account"),
  });

  const addLogin = async (formData: any) => {
    if (!selected) return;
    setAddLoginLoading(true);
    try {
      await api.post(`/admin/corporate/${selected.id}/login`, formData);
      toast.success("Portal login created");
      setAddingLogin(false);
      resetLogin();
      qc.invalidateQueries({ queryKey: ["corporate"] });
      const { data } = await api.get(
        `/admin/corporate${showArchived ? "?archived=true" : ""}`
      );
      const updated = data.data.find((a: any) => a.id === selected.id);
      if (updated) setSelected(updated);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Failed to create login");
    } finally {
      setAddLoginLoading(false);
    }
  };

  const doAction = async () => {
    if (!selected || !confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction === "archive") {
        await api.patch(`/admin/corporate/${selected.id}/archive`);
        toast.success(`${selected.name} archived`);
      } else if (confirmAction === "reactivate") {
        await api.patch(`/admin/corporate/${selected.id}/reactivate`);
        toast.success(`${selected.name} reactivated`);
      } else if (confirmAction === "delete") {
        await api.delete(`/admin/corporate/${selected.id}`);
        toast.success(`${selected.name} deleted`);
      }
      setConfirmAction(null);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["corporate"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const accounts: any[] = data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Corporate Accounts"
        subtitle={`${accounts.length} ${
          showArchived ? "archived" : "active"
        } accounts`}
        action={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-all ${
                showArchived
                  ? "bg-brand-500/10 text-brand-400 border-brand-500/30"
                  : "bg-[var(--table-hover)] text-slate-400 border-[var(--border)] hover:text-white"
              }`}
            >
              <Archive size={13} />
              {showArchived ? "Show Active" : "Show Archived"}
            </button>
            {!showArchived && (
              <button
                onClick={() => setCreating(true)}
                className="btn-primary flex items-center gap-2"
              >
                <Plus size={14} /> Add Account
              </button>
            )}
          </div>
        }
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Company",
              "Contact",
              "Email",
              "Payment Terms",
              "Credit Limit",
              "Passengers",
              "Jobs",
            ]}
            isEmpty={!accounts.length}
            emptyMessage={
              showArchived
                ? "No archived accounts"
                : "No corporate accounts yet"
            }
          >
            {accounts.map((a: any) => (
              <tr
                key={a.id}
                className="table-row cursor-pointer"
                onClick={() => {
                  setSelected(a);
                  setAddingLogin(false);
                  setConfirmAction(null);
                }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                        showArchived
                          ? "bg-slate-500/20 text-slate-400"
                          : "bg-violet-500/20 text-violet-400"
                      }`}
                    >
                      {a.name?.[0] ?? "?"}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white flex items-center gap-2">
                        {a.name}
                        {!a.isActive && (
                          <span className="text-[10px] bg-slate-500/20 text-slate-400 px-1.5 py-0.5 rounded">
                            Archived
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-slate-500">{a.address}</p>
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
                <td className="px-4 py-3 text-xs font-medium text-brand-400">
                  £{(a.creditLimit ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {a._count?.passengers ?? 0}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {a._count?.bookings ?? 0}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ─── Detail modal ──────────────────────────────────────────────────── */}
      <Modal
        open={!!selected && !confirmAction}
        onClose={() => {
          setSelected(null);
          setAddingLogin(false);
        }}
        title={selected?.name ?? ""}
      >
        {selected && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Users, label: "Contact", value: selected.contactName },
                { icon: Phone, label: "Phone", value: selected.contactPhone },
                {
                  icon: Mail,
                  label: "Contact Email",
                  value: selected.contactEmail,
                },
                {
                  icon: Mail,
                  label: "Invoicing Email",
                  value: selected.invoicingEmail,
                },
                {
                  icon: MapPin,
                  label: "Address",
                  value: selected.address,
                  full: true,
                },
                {
                  icon: Clock,
                  label: "Payment Terms",
                  value: `${selected.paymentTermsDays} days`,
                },
                {
                  icon: CreditCard,
                  label: "Credit Limit",
                  value: `£${(selected.creditLimit ?? 0).toFixed(2)}`,
                },
                {
                  icon: CreditCard,
                  label: "Current Balance",
                  value: `£${(selected.currentBalance ?? 0).toFixed(2)}`,
                },
              ].map(({ icon: Icon, label, value, full }: any) => (
                <div
                  key={label}
                  className={`info-cell ${full ? "col-span-2" : ""}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={11} className="text-slate-500" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">
                      {label}
                    </span>
                  </div>
                  <p
                    className="text-xs font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="info-cell text-center py-3">
                <BookOpen size={16} className="text-brand-400 mx-auto mb-1" />
                <p className="text-xl font-bold text-brand-400">
                  {selected._count?.bookings ?? 0}
                </p>
                <p className="text-[10px] text-slate-500">Total bookings</p>
              </div>
              <div className="info-cell text-center py-3">
                <Users size={16} className="text-violet-400 mx-auto mb-1" />
                <p className="text-xl font-bold text-violet-400">
                  {selected._count?.passengers ?? 0}
                </p>
                <p className="text-[10px] text-slate-500">Portal users</p>
              </div>
            </div>

            {/* Portal access */}
            <div
              className="pt-3 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <KeyRound size={13} className="text-slate-400" />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: "var(--text)" }}
                  >
                    Portal Access
                  </span>
                </div>
                {!addingLogin && selected.isActive && (
                  <button
                    onClick={() => setAddingLogin(true)}
                    className="text-xs text-brand-400 hover:text-brand-500 font-medium"
                  >
                    + Add login
                  </button>
                )}
              </div>
              {(selected._count?.passengers ?? 0) > 0 && !addingLogin ? (
                <div
                  className={`flex items-center gap-2 p-2.5 rounded-lg border ${
                    selected.isActive
                      ? "bg-green-500/10 border-green-500/20"
                      : "bg-slate-500/10 border-slate-500/20"
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      selected.isActive ? "bg-green-400" : "bg-slate-400"
                    }`}
                  />
                  <span
                    className={`text-xs ${
                      selected.isActive ? "text-green-400" : "text-slate-400"
                    }`}
                  >
                    {selected._count.passengers} portal user
                    {selected._count.passengers > 1 ? "s" : ""} —{" "}
                    {selected.isActive
                      ? "access active"
                      : "access suspended (archived)"}
                  </span>
                </div>
              ) : !addingLogin ? (
                <div className="p-2.5 rounded-lg bg-slate-500/10 border border-slate-500/20">
                  <span className="text-xs text-slate-500">
                    No portal login yet
                  </span>
                </div>
              ) : null}
              {addingLogin && (
                <form
                  onSubmit={handleLoginSubmit(addLogin)}
                  className="space-y-3"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        Portal Email
                      </label>
                      <input
                        type="email"
                        {...registerLogin("portalEmail", { required: true })}
                        className="input"
                        placeholder="login@company.com"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        {...registerLogin("portalPassword", { required: true })}
                        className="input"
                        placeholder="Min 8 chars"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        First Name
                      </label>
                      <input
                        {...registerLogin("portalFirstName", {
                          required: true,
                        })}
                        className="input"
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        Last Name
                      </label>
                      <input
                        {...registerLogin("portalLastName", { required: true })}
                        className="input"
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={addLoginLoading}
                      className="btn-primary flex items-center gap-2 text-xs py-2"
                    >
                      {addLoginLoading ? <Spinner size={12} /> : null} Create
                      Login
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingLogin(false);
                        resetLogin();
                      }}
                      className="btn-ghost text-xs py-2"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Actions */}
            <div
              className="flex gap-2 pt-2 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              {selected.isActive ? (
                <button
                  onClick={() => setConfirmAction("archive")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-yellow-400 transition-colors px-3 py-2 rounded-lg border border-[var(--border)] hover:border-yellow-500/30"
                >
                  <Archive size={13} /> Archive
                </button>
              ) : (
                <button
                  onClick={() => setConfirmAction("reactivate")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-green-400 transition-colors px-3 py-2 rounded-lg border border-[var(--border)] hover:border-green-500/30"
                >
                  <RotateCcw size={13} /> Reactivate
                </button>
              )}
              {(selected._count?.bookings ?? 0) === 0 && (
                <button
                  onClick={() => setConfirmAction("delete")}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors px-3 py-2 rounded-lg border border-[var(--border)] hover:border-red-500/30"
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Confirm action modal ──────────────────────────────────────────── */}
      <Modal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction === "archive"
            ? "Archive Account"
            : confirmAction === "reactivate"
            ? "Reactivate Account"
            : "Delete Account"
        }
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {confirmAction === "archive" &&
              `Archive ${selected?.name}? Their portal access will be suspended. You can reactivate at any time.`}
            {confirmAction === "reactivate" &&
              `Reactivate ${selected?.name}? Portal access will be restored.`}
            {confirmAction === "delete" &&
              `Permanently delete ${selected?.name}? This cannot be undone.`}
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
                confirmAction === "delete"
                  ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
                  : confirmAction === "reactivate"
                  ? "bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20"
                  : "bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20"
              }`}
            >
              {actionLoading ? <Spinner size={14} /> : null}
              {confirmAction === "archive"
                ? "Archive"
                : confirmAction === "reactivate"
                ? "Reactivate"
                : "Delete"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Create modal ──────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
          reset();
        }}
        title="New Corporate Account"
      >
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "name", label: "Company Name", full: true },
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
              {
                name: "creditLimit",
                label: "Credit Limit (£)",
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
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="text-xs text-slate-400 block mb-1">
                Address
              </label>
              <input
                {...register("address", { required: true })}
                className="input"
                placeholder="Full address"
              />
            </div>
            <div className="col-span-2 pt-2 border-t border-[var(--border)]">
              <p className="text-xs font-semibold text-white mb-1">
                Portal Login (optional)
              </p>
              <p className="text-[11px] text-slate-500 mb-3">
                Create login credentials so this company can access the
                corporate booking portal.
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Portal Email
              </label>
              <input
                type="email"
                {...register("portalEmail")}
                className="input"
                placeholder="login@company.com"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Portal Password
              </label>
              <input
                type="password"
                {...register("portalPassword")}
                className="input"
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                First Name
              </label>
              <input
                {...register("portalFirstName")}
                className="input"
                placeholder="Contact first name"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Last Name
              </label>
              <input
                {...register("portalLastName")}
                className="input"
                placeholder="Contact last name"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn-primary w-full mt-2"
          >
            {createMutation.isPending ? "Creating…" : "Create Account"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
