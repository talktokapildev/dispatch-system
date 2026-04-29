"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { Plus, Search, Download, Pencil, X, Check } from "lucide-react";
import {
  Badge,
  SectionHeader,
  Table,
  Pagination,
  Modal,
  Spinner,
} from "@/components/ui";
import toast from "react-hot-toast";
import { NewBookingModal } from "@/components/NewBookingModal";

const STATUSES = [
  "",
  "PENDING",
  "CONFIRMED",
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

const EDITABLE_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

const PAYMENT_METHODS = ["CARD", "CASH", "APPLE_PAY", "GOOGLE_PAY", "ACCOUNT"];

function getDispatcherName(booking: any): string {
  const u = booking.dispatchedByUser;
  if (!u) return "—";
  if (u.firstName) return `${u.firstName} ${u.lastName}`.trim();
  return u.phone ?? "—";
}

export default function BookingsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  const { data, isLoading } = useQuery({
    queryKey: ["bookings", page, status],
    queryFn: () =>
      api
        .get("/admin/bookings", {
          params: { page, limit: 25, ...(status && { status }) },
        })
        .then((r) => r.data.data),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/bookings/${id}/cancel`, { reason: "Cancelled by admin" }),
    onSuccess: () => {
      toast.success("Booking cancelled");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setSelected(null);
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to cancel"),
  });

  const dispatchMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/bookings/${id}/dispatch`),
    onSuccess: () => {
      toast.success("Dispatching to nearest available driver…");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      // Refresh selected to show updated dispatchedBy
      if (selected) {
        api
          .get(`/admin/bookings/${selected.id}`)
          .then((r) => setSelected(r.data.data))
          .catch(() => {});
      }
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Dispatch failed"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.patch(`/admin/bookings/${id}`, body),
    onSuccess: (_, { id }) => {
      toast.success("Booking updated");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      api
        .get(`/admin/bookings/${id}`)
        .then((r) => setSelected(r.data.data))
        .catch(() => setSelected(null));
      setEditing(false);
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Update failed"),
  });

  const openEdit = () => {
    setEditForm({
      status: selected.status,
      estimatedFare: selected.estimatedFare?.toString() ?? "",
      actualFare: selected.actualFare?.toString() ?? "",
      passengerCount: selected.passengerCount?.toString() ?? "1",
      paymentMethod: selected.paymentMethod ?? "CARD",
      notes: selected.notes ?? "",
      operatorNotes: selected.operatorNotes ?? "",
      flightNumber: selected.flightNumber ?? "",
      terminal: selected.terminal ?? "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    const body: any = {
      status: editForm.status,
      estimatedFare: parseFloat(editForm.estimatedFare) || undefined,
      actualFare: editForm.actualFare ? parseFloat(editForm.actualFare) : null,
      passengerCount: parseInt(editForm.passengerCount) || 1,
      paymentMethod: editForm.paymentMethod,
      notes: editForm.notes || null,
      operatorNotes: editForm.operatorNotes || null,
      flightNumber: editForm.flightNumber || null,
      terminal: editForm.terminal || null,
    };
    editMutation.mutate({ id: selected.id, body });
  };

  const set =
    (key: string) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) =>
      setEditForm((f: any) => ({ ...f, [key]: e.target.value }));

  const items = data?.items ?? [];
  const filtered = search
    ? items.filter(
        (b: any) =>
          b.reference.toLowerCase().includes(search.toLowerCase()) ||
          b.pickupAddress.toLowerCase().includes(search.toLowerCase()) ||
          b.passenger?.user?.phone?.includes(search)
      )
    : items;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Bookings"
        subtitle={`${data?.total ?? 0} total bookings`}
        action={
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> New Booking
          </button>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-9"
            placeholder="Search ref, address, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="input w-auto"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
        <button className="btn-ghost flex items-center gap-2">
          <Download size={14} /> Export
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <>
            <Table
              headers={[
                "Reference",
                "Passenger",
                "Pickup",
                "Dropoff",
                "Type",
                "Status",
                "Fare",
                "Driver",
                "Dispatched By",
                "Created",
              ]}
              isEmpty={!filtered.length}
              emptyMessage="No bookings found"
            >
              {filtered.map((b: any) => (
                <tr
                  key={b.id}
                  className="table-row cursor-pointer"
                  onClick={() => {
                    setSelected(b);
                    setEditing(false);
                  }}
                >
                  <td className="px-4 py-3 font-mono text-xs text-brand-400">
                    {b.reference}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "var(--text)" }}
                      >
                        {b.passenger?.user?.firstName}{" "}
                        {b.passenger?.user?.lastName}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {b.passenger?.user?.phone}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[160px]">
                    <p className="text-xs text-slate-400 truncate">
                      {b.pickupAddress}
                    </p>
                  </td>
                  <td className="px-4 py-3 max-w-[160px]">
                    <p className="text-xs text-slate-500 truncate">
                      {b.dropoffAddress}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={b.type} label={b.type.replace(/_/g, " ")} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-brand-400">
                    £{(b.actualFare ?? b.estimatedFare).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {b.driver ? (
                      <p className="text-xs" style={{ color: "var(--text)" }}>
                        {b.driver.user.firstName} {b.driver.user.lastName}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600">—</p>
                    )}
                  </td>
                  {/* TfL: Dispatcher column */}
                  <td className="px-4 py-3">
                    {b.dispatchedByUser ? (
                      <p className="text-xs" style={{ color: "var(--text)" }}>
                        {b.dispatchedByUser.firstName}{" "}
                        {b.dispatchedByUser.lastName}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600">—</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {format(new Date(b.createdAt), "dd MMM HH:mm")}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={page}
              totalPages={data?.totalPages ?? 1}
              onChange={setPage}
            />
          </>
        )}
      </div>

      <NewBookingModal open={creating} onClose={() => setCreating(false)} />

      {/* ── Booking detail / edit modal ── */}
      <Modal
        open={!!selected}
        onClose={() => {
          setSelected(null);
          setEditing(false);
        }}
        title={
          <div className="flex items-center justify-between w-full pr-6">
            <span className="font-mono text-brand-400 text-sm">
              {selected?.reference}
            </span>
            {selected && !editing && (
              <button
                onClick={openEdit}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
        }
      >
        {selected && !editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Status", value: <Badge status={selected.status} /> },
                {
                  label: "Type",
                  value: (
                    <Badge
                      status={selected.type}
                      label={selected.type.replace(/_/g, " ")}
                    />
                  ),
                },
                {
                  label: "Estimated Fare",
                  value: `£${selected.estimatedFare?.toFixed(2)}`,
                },
                {
                  label: "Actual Fare",
                  value: selected.actualFare
                    ? `£${selected.actualFare.toFixed(2)}`
                    : "—",
                },
                { label: "Payment", value: selected.paymentMethod },
                { label: "Passengers", value: selected.passengerCount },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]"
                >
                  <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                  <div
                    className="text-xs font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs">
                <div className="w-2 h-2 rounded-full bg-green-400 mt-1 shrink-0" />
                <p style={{ color: "var(--text)" }}>{selected.pickupAddress}</p>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <div className="w-2 h-2 rounded-full bg-red-400 mt-1 shrink-0" />
                <p className="text-slate-500">{selected.dropoffAddress}</p>
              </div>
            </div>

            {selected.flightNumber && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
                ✈ Flight {selected.flightNumber} · Terminal {selected.terminal}
                {selected.flightArrivalTime &&
                  ` · ${format(new Date(selected.flightArrivalTime), "HH:mm")}`}
              </div>
            )}

            {selected.notes && (
              <div className="p-3 rounded-lg bg-[var(--card-hover)] text-xs text-slate-400">
                📝 {selected.notes}
              </div>
            )}

            {selected.operatorNotes && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                🔒 {selected.operatorNotes}
              </div>
            )}

            {selected.driver && (
              <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs">
                <p className="text-slate-500 mb-1">Driver</p>
                <p style={{ color: "var(--text)" }} className="font-medium">
                  {selected.driver.user.firstName}{" "}
                  {selected.driver.user.lastName}
                </p>
              </div>
            )}

            {/* ── TfL Compliance: Dispatch Record ── */}
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                TfL Dispatch Record
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-slate-500 mb-0.5">Dispatched By</p>
                  <p style={{ color: "var(--text)" }} className="font-medium">
                    {getDispatcherName(selected)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 mb-0.5">Dispatched At</p>
                  <p style={{ color: "var(--text)" }} className="font-medium">
                    {selected.dispatchedAt
                      ? format(
                          new Date(selected.dispatchedAt),
                          "dd MMM yyyy HH:mm"
                        )
                      : "—"}
                  </p>
                </div>
              </div>
              {!selected.dispatchedByUser &&
                [
                  "DISPATCHED",
                  "DRIVER_ASSIGNED",
                  "DRIVER_EN_ROUTE",
                  "DRIVER_ARRIVED",
                  "IN_PROGRESS",
                  "COMPLETED",
                ].includes(selected.status) && (
                  <p className="text-amber-500 mt-2 text-[10px]">
                    ⚠ Dispatcher not recorded — predates compliance update
                  </p>
                )}
            </div>

            <div className="space-y-2 pt-1">
              {["PENDING", "CONFIRMED"].includes(selected.status) && (
                <button
                  onClick={() => dispatchMutation.mutate(selected.id)}
                  disabled={dispatchMutation.isPending}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {dispatchMutation.isPending
                    ? "Dispatching…"
                    : "🚖 Dispatch to Nearest Driver"}
                </button>
              )}
              {["PENDING", "CONFIRMED", "DRIVER_ASSIGNED"].includes(
                selected.status
              ) && (
                <button
                  onClick={() => cancelMutation.mutate(selected.id)}
                  disabled={cancelMutation.isPending}
                  className="btn-danger w-full"
                >
                  Cancel Booking
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Edit mode ── */}
        {selected && editing && (
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
                Status & Fare
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Status
                  </label>
                  <select
                    className="input w-full"
                    value={editForm.status}
                    onChange={set("status")}
                  >
                    {EDITABLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Payment Method
                  </label>
                  <select
                    className="input w-full"
                    value={editForm.paymentMethod}
                    onChange={set("paymentMethod")}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Estimated Fare (£)
                  </label>
                  <input
                    className="input w-full"
                    type="number"
                    step="0.01"
                    value={editForm.estimatedFare}
                    onChange={set("estimatedFare")}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Actual Fare (£)
                  </label>
                  <input
                    className="input w-full"
                    type="number"
                    step="0.01"
                    placeholder="Leave blank if not completed"
                    value={editForm.actualFare}
                    onChange={set("actualFare")}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Passengers
                  </label>
                  <input
                    className="input w-full"
                    type="number"
                    min="1"
                    max="16"
                    value={editForm.passengerCount}
                    onChange={set("passengerCount")}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
                Flight Info
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Flight Number
                  </label>
                  <input
                    className="input w-full font-mono"
                    placeholder="BA123"
                    value={editForm.flightNumber}
                    onChange={set("flightNumber")}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Terminal
                  </label>
                  <input
                    className="input w-full"
                    placeholder="T5"
                    value={editForm.terminal}
                    onChange={set("terminal")}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
                Notes
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Passenger Notes (visible to driver)
                  </label>
                  <textarea
                    className="input w-full resize-none"
                    rows={2}
                    placeholder="e.g. wheelchair needed, child seat…"
                    value={editForm.notes}
                    onChange={set("notes")}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Operator Notes (private 🔒)
                  </label>
                  <textarea
                    className="input w-full resize-none"
                    rows={2}
                    placeholder="Internal notes not visible to driver or passenger…"
                    value={editForm.operatorNotes}
                    onChange={set("operatorNotes")}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 btn-ghost py-2.5 text-sm flex items-center justify-center gap-2"
              >
                <X size={14} /> Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editMutation.isPending}
                className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2"
              >
                {editMutation.isPending ? (
                  "Saving…"
                ) : (
                  <>
                    <Check size={14} /> Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
