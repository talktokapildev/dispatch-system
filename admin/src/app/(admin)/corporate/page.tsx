"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import {
  SectionHeader,
  Table,
  Modal,
  EmptyState,
  Spinner,
} from "@/components/ui";
import { Building2, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";

export default function CorporatePage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["corporate"],
    queryFn: () => api.get("/admin/corporate").then((r) => r.data.data),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm();

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/admin/corporate", data),
    onSuccess: () => {
      toast.success("Corporate account created");
      qc.invalidateQueries({ queryKey: ["corporate"] });
      setCreating(false);
      reset();
    },
    onError: () => toast.error("Failed to create account"),
  });

  const accounts: any[] = data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Corporate Accounts"
        subtitle={`${accounts.length} accounts`}
        action={
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> Add Account
          </button>
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
            emptyMessage="No corporate accounts yet"
          >
            {accounts.map((a: any) => (
              <tr
                key={a.id}
                className="table-row cursor-pointer"
                onClick={() => setSelected(a)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400 text-xs font-bold">
                      {a.companyName[0]}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">
                        {a.companyName}
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
                  £{a.creditLimit.toFixed(2)}
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

      {/* Create modal */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New Corporate Account"
      >
        <form
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: "companyName", label: "Company Name", full: true },
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
            ].map(({ name, label, type = "text", full }) => (
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
            {/* Portal login */}
            <div className="col-span-2 pt-2 border-t border-[var(--border)]">
              <p className="text-xs font-semibold text-white mb-3">
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
