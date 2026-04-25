"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import {
  SectionHeader,
  Table,
  Modal,
  Spinner,
  EmptyState,
} from "@/components/ui";
import {
  Plus,
  MapPin,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";

const ZONE_TYPES = ["AIRPORT", "HOTEL", "VENUE", "OTHER"];

const TYPE_COLOURS: Record<string, string> = {
  AIRPORT: "bg-blue-500/20 text-blue-400",
  HOTEL: "bg-violet-500/20 text-violet-400",
  VENUE: "bg-green-500/20 text-green-400",
  OTHER: "bg-slate-500/20 text-slate-400",
};

export default function SurchargeZonesPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["surcharge-zones"],
    queryFn: () => api.get("/admin/surcharge-zones").then((r) => r.data.data),
  });

  const { register, handleSubmit, reset, setValue, watch } = useForm({
    defaultValues: {
      name: "",
      type: "AIRPORT",
      latitude: 0,
      longitude: 0,
      radiusMeters: 500,
      pickupFee: 0,
      dropoffFee: 0,
      isActive: true,
      notes: "",
    },
  });

  const openCreate = () => {
    setEditing(null);
    reset({
      radiusMeters: 500,
      pickupFee: 0,
      dropoffFee: 0,
      type: "AIRPORT",
      isActive: true,
    });
    setModalOpen(true);
  };
  const openEdit = (zone: any) => {
    setEditing(zone);
    reset({
      name: zone.name,
      type: zone.type,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radiusMeters: zone.radiusMeters,
      pickupFee: zone.pickupFee,
      dropoffFee: zone.dropoffFee,
      isActive: zone.isActive,
      notes: zone.notes ?? "",
    });
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      editing
        ? api.put(`/admin/surcharge-zones/${editing.id}`, data)
        : api.post("/admin/surcharge-zones", data),
    onSuccess: () => {
      toast.success(editing ? "Zone updated" : "Zone created");
      qc.invalidateQueries({ queryKey: ["surcharge-zones"] });
      setModalOpen(false);
      reset();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to save"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/admin/surcharge-zones/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surcharge-zones"] }),
    onError: () => toast.error("Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/surcharge-zones/${id}`),
    onSuccess: () => {
      toast.success("Zone deleted");
      qc.invalidateQueries({ queryKey: ["surcharge-zones"] });
      setDeleteId(null);
    },
    onError: () => toast.error("Failed to delete"),
  });

  const zones: any[] = data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Surcharge Zones"
        subtitle={`${zones.length} zones — airports, hotels and venues with access fees`}
        action={
          <button
            onClick={openCreate}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> Add Zone
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
              "Zone",
              "Type",
              "Radius",
              "Pick-up fee",
              "Drop-off fee",
              "Status",
              "",
            ]}
            isEmpty={!zones.length}
            emptyMessage="No surcharge zones yet — add Gatwick, Heathrow or any venue with access fees"
          >
            {zones.map((z: any) => (
              <tr key={z.id} className="table-row">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0">
                      <MapPin size={13} className="text-brand-400" />
                    </div>
                    <div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {z.name}
                      </p>
                      {z.notes && (
                        <p className="text-[10px] text-slate-500 truncate max-w-[200px]">
                          {z.notes}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-600">
                        {z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`badge text-[10px] ${
                      TYPE_COLOURS[z.type] ?? TYPE_COLOURS.OTHER
                    }`}
                  >
                    {z.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {z.radiusMeters}m
                </td>
                <td className="px-4 py-3 text-xs">
                  {z.pickupFee > 0 ? (
                    <span className="text-green-400 font-medium">
                      £{z.pickupFee.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {z.dropoffFee > 0 ? (
                    <span className="text-green-400 font-medium">
                      £{z.dropoffFee.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() =>
                      toggleMutation.mutate({ id: z.id, isActive: !z.isActive })
                    }
                    className="flex items-center gap-1.5 text-xs transition-colors"
                    style={{
                      color: z.isActive ? "var(--text-muted)" : "#64748b",
                    }}
                  >
                    {z.isActive ? (
                      <ToggleRight size={18} className="text-green-400" />
                    ) : (
                      <ToggleLeft size={18} className="text-slate-500" />
                    )}
                    <span>{z.isActive ? "Active" : "Inactive"}</span>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(z)}
                      className="text-slate-500 hover:text-brand-400 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteId(z.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* Info box */}
      <div
        className="p-4 rounded-xl border text-xs space-y-1"
        style={{
          background: "var(--table-hover)",
          borderColor: "var(--border)",
          color: "var(--text-muted)",
        }}
      >
        <p className="font-semibold" style={{ color: "var(--text)" }}>
          How surcharge zones work
        </p>
        <p>
          When a booking pickup or dropoff falls within a zone's radius, the
          corresponding fee is automatically added to the fare. Zones replace
          the old hardcoded airport detection — add Heathrow, Gatwick, Hilton
          Gatwick, or any venue here.
        </p>
        <p className="mt-1">
          <strong>Radius guide:</strong> Airport terminal ~1000–2000m · Hotel
          forecourt ~100–200m · Stadium ~500m
        </p>
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit — ${editing.name}` : "New Surcharge Zone"}
      >
        <form
          onSubmit={handleSubmit((d) => saveMutation.mutate(d))}
          className="space-y-4"
        >
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Zone name *
            </label>
            <input
              {...register("name", { required: true })}
              className="input"
              placeholder="e.g. London Gatwick South Terminal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Type</label>
              <select {...register("type")} className="input">
                {ZONE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Radius (metres)
              </label>
              <input
                type="number"
                {...register("radiusMeters", {
                  required: true,
                  valueAsNumber: true,
                })}
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Latitude *
              </label>
              <input
                type="number"
                step="any"
                {...register("latitude", {
                  required: true,
                  valueAsNumber: true,
                })}
                className="input"
                placeholder="51.1537"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Longitude *
              </label>
              <input
                type="number"
                step="any"
                {...register("longitude", {
                  required: true,
                  valueAsNumber: true,
                })}
                className="input"
                placeholder="-0.1821"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Pick-up fee (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("pickupFee", { valueAsNumber: true })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Drop-off fee (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("dropoffFee", { valueAsNumber: true })}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Notes (internal)
            </label>
            <input
              {...register("notes")}
              className="input"
              placeholder="e.g. Hilton access fee — pass-through only"
            />
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                {...register("isActive")}
                className="accent-brand-500"
              />
              <span className="text-xs" style={{ color: "var(--text)" }}>
                Active — apply this zone to fare estimates
              </span>
            </label>
          </div>

          <div
            className="pt-2 border-t flex justify-end gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saveMutation.isPending ? <Spinner size={14} /> : null}
              {editing ? "Save Changes" : "Create Zone"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Zone"
      >
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          Are you sure you want to delete this surcharge zone? This cannot be
          undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setDeleteId(null)}
            className="btn-ghost text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            disabled={deleteMutation.isPending}
            className="btn-danger flex items-center gap-2 text-sm"
          >
            {deleteMutation.isPending ? <Spinner size={14} /> : null} Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
