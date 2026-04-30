"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format, differenceInDays } from "date-fns";
import {
  Plus,
  Pencil,
  X,
  Check,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
} from "lucide-react";
import { SectionHeader, Spinner, Modal } from "@/components/ui";
import toast from "react-hot-toast";

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  role: string;
  adminProfile: {
    id: string;
    permissions: string[];
    dateOfBirth: string | null;
    dbsCertificateNumber: string | null;
    dbsCheckDate: string | null;
  } | null;
}

function dbsStatus(dbsCheckDate: string | null): {
  label: string;
  color: string;
  icon: React.ReactNode;
} {
  if (!dbsCheckDate)
    return {
      label: "Not recorded",
      color: "text-slate-500",
      icon: <ShieldOff size={14} />,
    };

  const days = differenceInDays(new Date(), new Date(dbsCheckDate));
  if (days > 365)
    return {
      label: `Expired (${Math.floor(days / 365)}y ago)`,
      color: "text-red-400",
      icon: <ShieldAlert size={14} />,
    };
  if (days > 300)
    return {
      label: `Expires soon (${365 - days}d)`,
      color: "text-amber-400",
      icon: <ShieldAlert size={14} />,
    };
  return {
    label: `Valid (${365 - days}d remaining)`,
    color: "text-green-400",
    icon: <ShieldCheck size={14} />,
  };
}

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  role: "DISPATCHER" as "ADMIN" | "DISPATCHER",
  password: "",
  dateOfBirth: "",
  dbsCertificateNumber: "",
  dbsCheckDate: "",
};

export default function StaffRegisterPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [createForm, setCreateForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () =>
      api.get("/admin/staff").then((r) => r.data.data as StaffMember[]),
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: any }) =>
      api.patch(`/admin/staff/${userId}`, body),
    onSuccess: () => {
      toast.success("Staff record updated");
      qc.invalidateQueries({ queryKey: ["staff"] });
      setEditing(null);
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Update failed"),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/admin/staff", body),
    onSuccess: () => {
      toast.success("Staff member created");
      qc.invalidateQueries({ queryKey: ["staff"] });
      setCreating(false);
      setCreateForm(EMPTY_FORM);
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to create staff member"),
  });

  const openEdit = (member: StaffMember) => {
    setEditForm({
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email ?? "",
      dateOfBirth: member.adminProfile?.dateOfBirth
        ? member.adminProfile.dateOfBirth.split("T")[0]
        : "",
      dbsCertificateNumber: member.adminProfile?.dbsCertificateNumber ?? "",
      dbsCheckDate: member.adminProfile?.dbsCheckDate
        ? member.adminProfile.dbsCheckDate.split("T")[0]
        : "",
    });
    setEditing(member);
  };

  const set =
    (key: string, form: "edit" | "create") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (form === "edit")
        setEditForm((f: any) => ({ ...f, [key]: e.target.value }));
      else setCreateForm((f) => ({ ...f, [key]: e.target.value }));
    };

  const staff = data ?? [];

  // Stats
  const missingDbs = staff.filter(
    (s) => !s.adminProfile?.dbsCertificateNumber
  ).length;
  const expiredDbs = staff.filter((s) => {
    const d = s.adminProfile?.dbsCheckDate;
    if (!d) return false;
    return differenceInDays(new Date(), new Date(d)) > 365;
  }).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Staff Register"
        subtitle="TfL Condition 19 — all staff taking or dispatching bookings"
        action={
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> Add Staff Member
          </button>
        }
      />

      {/* Compliance summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs text-slate-500 mb-1">Total Staff</p>
          <p className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {staff.length}
          </p>
        </div>
        <div
          className={`card p-4 ${missingDbs > 0 ? "border-amber-500/30" : ""}`}
        >
          <p className="text-xs text-slate-500 mb-1">Missing DBS</p>
          <p
            className={`text-2xl font-bold ${
              missingDbs > 0 ? "text-amber-400" : "text-green-400"
            }`}
          >
            {missingDbs}
          </p>
        </div>
        <div
          className={`card p-4 ${expiredDbs > 0 ? "border-red-500/30" : ""}`}
        >
          <p className="text-xs text-slate-500 mb-1">Expired DBS</p>
          <p
            className={`text-2xl font-bold ${
              expiredDbs > 0 ? "text-red-400" : "text-green-400"
            }`}
          >
            {expiredDbs}
          </p>
        </div>
      </div>

      {/* Staff table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No staff members found
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {[
                  "Name",
                  "Role",
                  "Phone",
                  "Date of Birth",
                  "DBS Certificate No.",
                  "DBS Check Date",
                  "DBS Status",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-slate-500 font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => {
                const dbs = dbsStatus(
                  member.adminProfile?.dbsCheckDate ?? null
                );
                const missingFields = [
                  !member.adminProfile?.dateOfBirth && "DOB",
                  !member.adminProfile?.dbsCertificateNumber && "DBS No.",
                  !member.adminProfile?.dbsCheckDate && "DBS date",
                ].filter(Boolean);

                return (
                  <tr
                    key={member.id}
                    className="border-b border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {member.firstName} {member.lastName}
                      </p>
                      {member.email && (
                        <p className="text-xs text-slate-500">{member.email}</p>
                      )}
                      {missingFields.length > 0 && (
                        <p className="text-[10px] text-amber-500 mt-0.5">
                          ⚠ Missing: {missingFields.join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          member.role === "ADMIN"
                            ? "bg-purple-500/10 text-purple-400"
                            : "bg-blue-500/10 text-blue-400"
                        }`}
                      >
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono">
                      {member.phone}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {member.adminProfile?.dateOfBirth ? (
                        format(
                          new Date(member.adminProfile.dateOfBirth),
                          "dd MMM yyyy"
                        )
                      ) : (
                        <span className="text-amber-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-400">
                      {member.adminProfile?.dbsCertificateNumber || (
                        <span className="text-amber-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {member.adminProfile?.dbsCheckDate ? (
                        format(
                          new Date(member.adminProfile.dbsCheckDate),
                          "dd MMM yyyy"
                        )
                      ) : (
                        <span className="text-amber-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className={`flex items-center gap-1.5 text-xs ${dbs.color}`}
                      >
                        {dbs.icon}
                        {dbs.label}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(member)}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Edit staff modal ── */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.firstName} ${editing.lastName}` : ""}
      >
        {editing && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
                Personal Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    First Name
                  </label>
                  <input
                    className="input w-full"
                    value={editForm.firstName}
                    onChange={set("firstName", "edit")}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Last Name
                  </label>
                  <input
                    className="input w-full"
                    value={editForm.lastName}
                    onChange={set("lastName", "edit")}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 mb-1 block">
                    Email
                  </label>
                  <input
                    className="input w-full"
                    type="email"
                    value={editForm.email}
                    onChange={set("email", "edit")}
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 mb-1 block">
                    Date of Birth
                  </label>
                  <input
                    className="input w-full"
                    type="date"
                    value={editForm.dateOfBirth}
                    onChange={set("dateOfBirth", "edit")}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
                DBS Details (TfL Condition 19)
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    DBS Certificate Number
                  </label>
                  <input
                    className="input w-full font-mono"
                    placeholder="e.g. 001234567890"
                    value={editForm.dbsCertificateNumber}
                    onChange={set("dbsCertificateNumber", "edit")}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    DBS Check Date
                  </label>
                  <input
                    className="input w-full"
                    type="date"
                    value={editForm.dbsCheckDate}
                    onChange={set("dbsCheckDate", "edit")}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    DBS checks should be renewed annually
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 btn-ghost py-2.5 flex items-center justify-center gap-2"
              >
                <X size={14} /> Cancel
              </button>
              <button
                onClick={() =>
                  updateMutation.mutate({
                    userId: editing.id,
                    body: {
                      firstName: editForm.firstName,
                      lastName: editForm.lastName,
                      email: editForm.email || null,
                      dateOfBirth: editForm.dateOfBirth || null,
                      dbsCertificateNumber:
                        editForm.dbsCertificateNumber || null,
                      dbsCheckDate: editForm.dbsCheckDate || null,
                    },
                  })
                }
                disabled={updateMutation.isPending}
                className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2"
              >
                {updateMutation.isPending ? (
                  "Saving…"
                ) : (
                  <>
                    <Check size={14} /> Save
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create staff modal ── */}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
          setCreateForm(EMPTY_FORM);
        }}
        title="Add Staff Member"
      >
        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Account Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  First Name *
                </label>
                <input
                  className="input w-full"
                  value={createForm.firstName}
                  onChange={set("firstName", "create")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Last Name *
                </label>
                <input
                  className="input w-full"
                  value={createForm.lastName}
                  onChange={set("lastName", "create")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Phone *
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="+447..."
                  value={createForm.phone}
                  onChange={set("phone", "create")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Email
                </label>
                <input
                  className="input w-full"
                  type="email"
                  value={createForm.email}
                  onChange={set("email", "create")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Role *
                </label>
                <select
                  className="input w-full"
                  value={createForm.role}
                  onChange={set("role", "create")}
                >
                  <option value="DISPATCHER">Dispatcher</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Password *
                </label>
                <input
                  className="input w-full"
                  type="password"
                  placeholder="Min 8 characters"
                  value={createForm.password}
                  onChange={set("password", "create")}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              TfL Compliance (Condition 19)
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Date of Birth
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={createForm.dateOfBirth}
                  onChange={set("dateOfBirth", "create")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  DBS Certificate Number
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="e.g. 001234567890"
                  value={createForm.dbsCertificateNumber}
                  onChange={set("dbsCertificateNumber", "create")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  DBS Check Date
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={createForm.dbsCheckDate}
                  onChange={set("dbsCheckDate", "create")}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={() => {
                setCreating(false);
                setCreateForm(EMPTY_FORM);
              }}
              className="flex-1 btn-ghost py-2.5 flex items-center justify-center gap-2"
            >
              <X size={14} /> Cancel
            </button>
            <button
              onClick={() => createMutation.mutate(createForm)}
              disabled={
                createMutation.isPending ||
                !createForm.firstName ||
                !createForm.lastName ||
                !createForm.phone ||
                !createForm.password
              }
              className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2"
            >
              {createMutation.isPending ? (
                "Creating…"
              ) : (
                <>
                  <Check size={14} /> Create
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
