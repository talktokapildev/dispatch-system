"use client";
// Vehicles: the fleet, independent of drivers. Add, edit, assign to a driver, retire.
// Bookings record the vehicle that did each trip, so changing or retiring a car never rewrites history.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { AlertTriangle, Archive, CarFront, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Modal, SectionHeader, Spinner, Table } from "@/components/ui";
import { DocumentsPanel } from "@/components/Documents";
import { VehicleDriverHistory } from "@/components/VehicleHistory";
import {
  EMPTY_VEHICLE_FORM,
  VehicleFormFields,
  vehicleFormFrom,
  vehiclePayload,
  type VehicleForm,
} from "@/components/VehicleForm";

type Filter = "active" | "retired" | "all";

const errMsg = (err: any, fallback: string) => err?.response?.data?.error ?? fallback;
const driverName = (d: any) => (d ? `${d.user.firstName} ${d.user.lastName ?? ""}`.trim() : "");

/** "12 Mar 2027", red if past, amber within 30 days. */
function Expiry({ date, label }: { date?: string | null; label?: string }) {
  if (!date) return <span className="text-xs text-slate-600">—</span>;
  const d = new Date(date);
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const cls = days < 0 ? "text-red-400 font-medium" : days <= 30 ? "text-amber-400 font-medium" : "text-slate-400";
  return (
    <span className={`text-xs ${cls}`} title={days < 0 ? "Expired" : `${days} days left`}>
      {days <= 30 && <AlertTriangle size={10} className="inline mr-1" />}
      {label ? `${label} ` : ""}
      {format(d, "dd MMM yyyy")}
    </span>
  );
}

/** "expired" if MOT, insurance or PHV licence has run out; "soon" if one runs out within 30 days. */
function expiryState(v: any): "expired" | "soon" | null {
  const dates = [v.motExpiry, v.insuranceExpiry, v.phvLicenceExpiry]
    .filter(Boolean)
    .map((x: string) => new Date(x).getTime());
  if (dates.some((t) => t < Date.now())) return "expired";
  if (dates.some((t) => t <= Date.now() + 30 * 86_400_000)) return "soon";
  return null;
}

function TripList({
  title,
  trips,
  upcoming,
  empty,
}: {
  title: string;
  trips: any[];
  upcoming?: boolean;
  empty?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">{title}</p>
      {trips.length === 0 ? (
        <p className="text-xs text-slate-600">{empty}</p>
      ) : (
        <div className="space-y-1">
          {trips.map((b) => (
            <a
              key={b.id}
              href={`/bookings?open=${b.id}`}
              className="flex items-center justify-between gap-3 text-xs p-2 rounded-lg hover:bg-[var(--card-hover)]"
            >
              <span className="font-mono text-slate-300 shrink-0">{b.reference}</span>
              <span className="text-slate-400 truncate flex-1">
                {b.pickupAddress} → {b.dropoffAddress}
              </span>
              <span className="text-slate-500 shrink-0">
                {[
                  driverName(b.driver),
                  format(
                    new Date((upcoming ? b.scheduledAt : b.completedAt) ?? b.createdAt),
                    upcoming ? "dd MMM, HH:mm" : "dd MMM yyyy"
                  ),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VehiclesPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(EMPTY_VEHICLE_FORM);
  const [formDriverId, setFormDriverId] = useState("");
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState<null | "retire" | "delete">(null);

  // Open a vehicle from a link: /vehicles?id=…
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelectedId(id);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["vehicles", filter],
    queryFn: () => api.get("/admin/vehicles", { params: { status: filter } }).then((r) => r.data.data),
  });
  const { data: driversData } = useQuery({
    queryKey: ["drivers", ""],
    queryFn: () => api.get("/admin/drivers", { params: { limit: 100 } }).then((r) => r.data.data),
  });
  const { data: selected, isLoading: selectedLoading } = useQuery({
    queryKey: ["vehicle", selectedId],
    queryFn: () => api.get(`/admin/vehicles/${selectedId}`).then((r) => r.data.data),
    enabled: !!selectedId,
  });

  const vehicles: any[] = data?.items ?? [];
  const fleet: number = data?.fleetCount ?? 0;
  const cap: number = data?.cap ?? 20;
  const atCap = fleet >= cap;
  const drivers: any[] = (driversData?.items ?? driversData ?? []).filter((d: any) => !d.archivedAt);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      [v.licensePlate, `${v.make}${v.model}`, driverName(v.driver)]
        .join(" ")
        .toLowerCase()
        .replace(/\s+/g, "")
        .includes(q)
    );
  }, [vehicles, search]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["vehicles"] });
    qc.invalidateQueries({ queryKey: ["vehicle"] });
    qc.invalidateQueries({ queryKey: ["drivers"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = vehiclePayload(form);
      return editingId
        ? api.patch(`/admin/vehicles/${editingId}`, payload)
        : api.post("/admin/vehicles", { ...payload, driverId: formDriverId || null });
    },
    onSuccess: (res) => {
      toast.success(editingId ? "Vehicle updated" : "Vehicle added");
      setFormOpen(false);
      if (!editingId) setSelectedId(res.data.data.id);
      refresh();
    },
    onError: (err) => setFormError(errMsg(err, "Could not save the vehicle")),
  });

  const assign = useMutation({
    mutationFn: (driverId: string | null) =>
      api.post(`/admin/vehicles/${selectedId}/assign`, { driverId }),
    onSuccess: (res, driverId) => {
      const moved = res.data.data.movedFromDriverId;
      const from = moved ? drivers.find((d) => d.id === moved) : null;
      toast.success(
        driverId
          ? `Assigned${from ? ` (taken from ${driverName(from)})` : ""}`
          : "Vehicle unassigned"
      );
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, "Could not change the driver")),
  });

  const retire = useMutation({
    mutationFn: () => api.post(`/admin/vehicles/${selectedId}/retire`),
    onSuccess: () => {
      toast.success("Vehicle retired");
      setConfirm(null);
      refresh();
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(errMsg(err, "Could not retire the vehicle"));
    },
  });

  const restore = useMutation({
    mutationFn: () => api.post(`/admin/vehicles/${selectedId}/restore`),
    onSuccess: () => {
      toast.success("Vehicle back on the fleet");
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, "Could not restore the vehicle")),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/vehicles/${selectedId}`),
    onSuccess: () => {
      toast.success("Vehicle deleted");
      setConfirm(null);
      setSelectedId(null);
      refresh();
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(errMsg(err, "Could not delete the vehicle"));
    },
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_VEHICLE_FORM);
    setFormDriverId("");
    setFormError("");
    setFormOpen(true);
  };
  const openEdit = (v: any) => {
    setEditingId(v.id);
    setForm(vehicleFormFrom(v));
    setFormError("");
    setFormOpen(true);
  };
  const submit = () => {
    setFormError("");
    const missing = (["make", "model", "licensePlate", "motExpiry", "insuranceExpiry"] as const).filter(
      (k) => !form[k].trim()
    );
    if (missing.length) return setFormError("Please fill in all required fields (*).");
    save.mutate();
  };

  const retired = !!selected?.archivedAt;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Vehicles"
        subtitle={`${fleet} / ${cap} on the fleet (TfL licence limit)`}
        action={
          <button
            onClick={openAdd}
            disabled={atCap}
            title={atCap ? `TfL vehicle cap reached (${fleet}/${cap})` : undefined}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
          >
            <Plus size={15} /> Add Vehicle
          </button>
        }
      />

      {(atCap || fleet >= cap - 2) && (
        <div
          className={`card p-4 ${atCap ? "border-red-500/30 bg-red-500/5" : "border-yellow-500/20 bg-yellow-500/5"}`}
        >
          <div className={`flex items-center gap-2 ${atCap ? "text-red-400" : "text-yellow-400"}`}>
            <AlertTriangle size={14} />
            <span className="text-sm font-medium">
              {atCap ? "TfL vehicle cap reached" : "Approaching TfL vehicle cap"} — {fleet}/{cap} vehicles
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 ml-5">
            {atCap
              ? `Your licence permits a maximum of ${cap} vehicles. Retire a vehicle before adding another.`
              : `You can add ${cap - fleet} more vehicle${cap - fleet === 1 ? "" : "s"}. Retired vehicles don't count.`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search registration, make, driver…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
          {(["active", "retired", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 capitalize ${
                filter === f ? "bg-brand-500 text-black font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              {f === "active" ? "On fleet" : f}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={["Vehicle", "Registration", "Driver", "MOT", "Insurance", "PHV licence", "ULEZ", "Last trip", "Status"]}
            isEmpty={!filtered.length}
            emptyMessage={filter === "retired" ? "No retired vehicles" : "No vehicles found"}
          >
            {filtered.map((v) => (
              <tr
                key={v.id}
                className={`table-row cursor-pointer ${v.archivedAt ? "opacity-50" : ""}`}
                onClick={() => setSelectedId(v.id)}
              >
                <td className="px-4 py-3">
                  <p className="text-xs text-white">
                    {v.make} {v.model}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {[v.year, v.colour, v.class, `${v.seats} seats`].filter(Boolean).join(" · ")}
                  </p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">{v.licensePlate}</td>
                <td className="px-4 py-3 text-xs">
                  {v.driver ? (
                    <span className="text-white">{driverName(v.driver)}</span>
                  ) : (
                    <span className="text-slate-600">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Expiry date={v.motExpiry} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Expiry date={v.insuranceExpiry} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <p className="font-mono text-xs text-slate-300">{v.phvLicenceNumber ?? "—"}</p>
                  {v.phvLicenceExpiry && <Expiry date={v.phvLicenceExpiry} />}
                </td>
                <td className="px-4 py-3">
                  {v.isUlezCompliant ? (
                    <span className="text-xs text-green-400 font-medium">✓ ULEZ</span>
                  ) : (
                    <span className="text-xs text-red-400">✗ Non-ULEZ</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                  {v.lastTripAt ? format(new Date(v.lastTripAt), "dd MMM yyyy") : "—"}
                  <p className="text-[10px] text-slate-600">
                    {v._count.bookings} booking{v._count.bookings === 1 ? "" : "s"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {v.archivedAt ? (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-500"
                      title={`Ceased ${format(new Date(v.archivedAt), "dd MMM yyyy")}`}
                    >
                      RETIRED {format(new Date(v.archivedAt), "dd/MM/yy")}
                    </span>
                  ) : expiryState(v) === "expired" ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                      EXPIRED
                    </span>
                  ) : expiryState(v) === "soon" ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                      DUE SOON
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
                      ON FLEET
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ── Vehicle detail ── */}
      <Modal
        open={!!selectedId}
        onClose={() => {
          setSelectedId(null);
          if (window.location.search) window.history.replaceState(null, "", "/vehicles");
        }}
        title={
          selected ? (
            <span className="flex items-center gap-2">
              <CarFront size={16} /> {selected.make} {selected.model}
              <span className="font-mono text-slate-400">{selected.licensePlate}</span>
              {retired && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-500">
                  RETIRED
                </span>
              )}
            </span>
          ) : (
            "Vehicle"
          )
        }
        size="lg"
      >
        {selectedLoading || !selected ? (
          <div className="flex justify-center py-10">
            <Spinner size={20} />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Driver */}
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Driver</p>
              {retired ? (
                <p className="text-xs text-slate-400">Retired vehicles can't be assigned. Restore it first.</p>
              ) : (
                <div className="flex gap-2 items-center">
                  <select
                    className="input flex-1"
                    value={selected.driverId ?? ""}
                    disabled={assign.isPending}
                    onChange={(e) => assign.mutate(e.target.value || null)}
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {driverName(d)}
                        {d.vehicle && d.vehicle.id !== selected.id
                          ? ` — currently ${d.vehicle.licensePlate}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {assign.isPending && <Spinner size={14} />}
                </div>
              )}
              <p className="text-[10px] text-slate-500 mt-2">
                A driver has one vehicle at a time. Their previous car becomes unassigned. Jobs they've
                accepted but not started switch to this car; trips under way keep the car they started
                with.
              </p>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                ["Year / colour", [selected.year, selected.colour].filter(Boolean).join(" · ") || "—"],
                ["Class / seats", `${selected.class} · ${selected.seats} seats`],
                ["Emission", selected.emissionStandard ?? "—"],
                ["MOT expiry", <Expiry key="m" date={selected.motExpiry} />],
                ["Insurance expiry", <Expiry key="i" date={selected.insuranceExpiry} />],
                ["ULEZ", selected.isUlezCompliant ? "✓ Compliant" : "✗ Non-ULEZ"],
                ["PHV licence", <span key="p" className="font-mono">{selected.phvLicenceNumber ?? "—"}</span>],
                ["PHV expiry", <Expiry key="pe" date={selected.phvLicenceExpiry} />],
                ["PHV disc", <span key="d" className="font-mono">{selected.phvDiscNumber ?? "—"}</span>],
                ["Registered keeper", selected.keeperName ?? "—"],
                ["Start date", selected.startDate ? format(new Date(selected.startDate), "dd MMM yyyy") : "—"],
                ["Vehicle ceased", selected.archivedAt ? format(new Date(selected.archivedAt), "dd MMM yyyy") : "—"],
              ].map(([label, value]) => (
                <div
                  key={label as string}
                  className="p-2.5 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]"
                >
                  <p className="text-[10px] text-slate-500">{label}</p>
                  <div className="text-xs text-[var(--text)] font-medium mt-0.5">{value}</div>
                </div>
              ))}
            </div>
            {selected.keeperAddress && (
              <p className="text-xs text-slate-400 whitespace-pre-wrap">
                <span className="text-slate-500">Keeper address: </span>
                {selected.keeperAddress}
              </p>
            )}
            {selected.notes && (
              <p className="text-xs text-slate-400 whitespace-pre-wrap">
                <span className="text-slate-500">Notes: </span>
                {selected.notes}
              </p>
            )}

            {/* Driver history */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Driver history</p>
                <a
                  href={`/tfl-records?vehicle=${selected.id}`}
                  className="text-[10px] text-brand-400 hover:text-brand-300"
                >
                  TfL vehicle record →
                </a>
              </div>
              <VehicleDriverHistory vehicleId={selected.id} />
            </div>

            {/* Documents */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Documents</p>
                <a href={`/documents?vehicle=${selected.id}&tab=all`} className="text-[11px] text-brand-400 hover:underline">
                  View in Documents →
                </a>
              </div>
              <DocumentsPanel vehicleId={selected.id} ownerLabel={selected.licensePlate} />
            </div>

            {/* Trips */}
            {selected.upcoming?.length > 0 && (
              <TripList title="Assigned jobs" trips={selected.upcoming} upcoming />
            )}
            <TripList
              title={`Recent trips (${selected.completedCount} completed)`}
              trips={selected.recentTrips ?? []}
              empty="No completed trips yet."
            />

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border)]">
              <button
                onClick={() => openEdit(selected)}
                className="btn-ghost border border-[var(--border)] flex items-center gap-1.5 text-sm"
              >
                <Pencil size={13} /> Edit details
              </button>
              {retired ? (
                <button
                  onClick={() => restore.mutate()}
                  disabled={restore.isPending}
                  className="btn-ghost border border-[var(--border)] flex items-center gap-1.5 text-sm"
                >
                  <RotateCcw size={13} /> Restore to fleet
                </button>
              ) : (
                <button
                  onClick={() => setConfirm("retire")}
                  className="btn-ghost border border-[var(--border)] flex items-center gap-1.5 text-sm"
                >
                  <Archive size={13} /> Retire
                </button>
              )}
              {selected._count.bookings === 0 && (
                <button
                  onClick={() => setConfirm("delete")}
                  className="btn-danger flex items-center gap-1.5 text-sm ml-auto"
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add / edit ── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "Edit vehicle" : "Add vehicle"}
        size="lg"
      >
        <div className="space-y-5">
          {!editingId && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Driver</label>
              <select className="input w-full" value={formDriverId} onChange={(e) => setFormDriverId(e.target.value)}>
                <option value="">Unassigned for now</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {driverName(d)}
                    {d.vehicle ? ` — replaces ${d.vehicle.licensePlate}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <VehicleFormFields form={form} setForm={setForm} />
        </div>
        {formError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-3">
            {formError}
          </p>
        )}
        <div className="flex gap-3 pt-4">
          <button onClick={() => setFormOpen(false)} className="flex-1 btn-ghost py-2.5 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={save.isPending}
            className="flex-1 px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
          >
            {save.isPending ? "Saving…" : editingId ? "Save changes" : "Add vehicle"}
          </button>
        </div>
      </Modal>

      {/* ── Confirm retire / delete ── */}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === "delete" ? "Delete vehicle" : "Retire vehicle"}
      >
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          {confirm === "delete"
            ? `Delete ${selected?.licensePlate}? It has never been on a booking, so nothing else changes. This can't be undone.`
            : `Retire ${selected?.licensePlate}? It will be unassigned${
                selected?.driver ? ` from ${driverName(selected.driver)}` : ""
              } and stop counting towards your TfL limit. Past bookings keep showing it. You can restore it later.`}
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setConfirm(null)} className="btn-ghost text-sm">
            Cancel
          </button>
          <button
            onClick={() => (confirm === "delete" ? remove.mutate() : retire.mutate())}
            disabled={remove.isPending || retire.isPending}
            className="btn-danger flex items-center gap-2 text-sm"
          >
            {(remove.isPending || retire.isPending) && <Spinner size={14} />}
            {confirm === "delete" ? "Delete" : "Retire"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
