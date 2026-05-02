"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { Search, AlertTriangle, UserPlus, Pencil, Trash2 } from "lucide-react";
import {
  DriverBadge,
  SectionHeader,
  Table,
  Spinner,
  Modal,
} from "@/components/ui";

const STATUSES = ["", "AVAILABLE", "ON_JOB", "BREAK", "OFFLINE"];
const VEHICLE_CLASSES = ["STANDARD", "EXECUTIVE", "MPV", "MINIBUS"];
const EMISSION_STANDARDS = [
  "",
  "Euro 4",
  "Euro 5",
  "Euro 6",
  "Electric",
  "Hybrid",
  "Plug-in Hybrid",
];

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  phone: "+44",
  email: "",
  pcoBadgeNumber: "",
  pcoLicenseExpiry: "",
  drivingLicenseNumber: "",
  make: "",
  model: "",
  year: "",
  colour: "",
  licensePlate: "",
  vehicleClass: "STANDARD",
  seats: "4",
  motExpiry: "",
  insuranceExpiry: "",
  phvLicenceNumber: "",
  phvLicenceExpiry: "",
  phvDiscNumber: "",
  emissionStandard: "", // TfL Item 5
  isUlezCompliant: "false", // TfL Item 5
};

export default function DriversPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["drivers", status],
    queryFn: () =>
      api
        .get("/admin/drivers", {
          params: { ...(status && { status }), limit: 100 },
        })
        .then((r) => r.data.data),
    refetchInterval: 15_000,
  });

  const { data: expiringDocs } = useQuery({
    queryKey: ["expiring-docs"],
    queryFn: () =>
      api
        .get("/admin/drivers/documents/expiring", { params: { days: 60 } })
        .then((r) => r.data.data),
  });

  const addDriver = useMutation({
    mutationFn: (payload: any) => api.post("/admin/drivers", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setFormError("");
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.error ?? "Failed to create driver");
    },
  });

  const editDriver = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      api.put(`/admin/drivers/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setShowAdd(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setFormError("");
    },
    onError: (err: any) =>
      setFormError(err.response?.data?.error ?? "Failed to update driver"),
  });

  const deleteDriver = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/drivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setDeleteId(null);
      setSelected(null);
    },
    onError: () => setFormError("Failed to delete driver"),
  });

  const openEdit = (d: any) => {
    setEditing(d);
    setForm({
      firstName: d.user.firstName,
      lastName: d.user.lastName,
      phone: d.user.phone,
      email: d.user.email ?? "",
      pcoBadgeNumber: d.pcoBadgeNumber,
      pcoLicenseExpiry: d.pcoLicenseExpiry?.split("T")[0] ?? "",
      drivingLicenseNumber: d.drivingLicenseNumber ?? "",
      make: d.vehicle?.make ?? "",
      model: d.vehicle?.model ?? "",
      year: d.vehicle?.year?.toString() ?? "",
      colour: d.vehicle?.colour ?? "",
      licensePlate: d.vehicle?.licensePlate ?? "",
      vehicleClass: d.vehicle?.class ?? "STANDARD",
      seats: d.vehicle?.seats?.toString() ?? "4",
      motExpiry: d.vehicle?.motExpiry?.split("T")[0] ?? "",
      insuranceExpiry: d.vehicle?.insuranceExpiry?.split("T")[0] ?? "",
      phvLicenceNumber: d.vehicle?.phvLicenceNumber ?? "",
      phvLicenceExpiry: d.vehicle?.phvLicenceExpiry?.split("T")[0] ?? "",
      phvDiscNumber: d.vehicle?.phvDiscNumber ?? "",
      emissionStandard: d.vehicle?.emissionStandard ?? "",
      isUlezCompliant: d.vehicle?.isUlezCompliant ? "true" : "false",
    });
    setFormError("");
    setShowAdd(true);
    setSelected(null);
  };

  const set =
    (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = () => {
    setFormError("");
    if (!editing) {
      const required = [
        "firstName",
        "lastName",
        "phone",
        "pcoBadgeNumber",
        "pcoLicenseExpiry",
        "drivingLicenseNumber",
        "make",
        "model",
        "licensePlate",
        "motExpiry",
        "insuranceExpiry",
      ];
      const missing = required.find(
        (k) => !form[k as keyof typeof form].trim()
      );
      if (missing) {
        setFormError("Please fill in all required fields");
        return;
      }
    }

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      pcoBadgeNumber: form.pcoBadgeNumber.trim(),
      pcoLicenseExpiry: form.pcoLicenseExpiry,
      drivingLicenseNumber: form.drivingLicenseNumber.trim(),
      vehicle: {
        make: form.make.trim(),
        model: form.model.trim(),
        year: parseInt(form.year) || new Date().getFullYear(),
        colour: form.colour.trim(),
        licensePlate: form.licensePlate.trim().toUpperCase(),
        class: form.vehicleClass,
        seats: parseInt(form.seats) || 4,
        motExpiry: form.motExpiry,
        insuranceExpiry: form.insuranceExpiry,
        phvLicenceNumber: form.phvLicenceNumber.trim() || undefined,
        phvLicenceExpiry: form.phvLicenceExpiry || undefined,
        phvDiscNumber: form.phvDiscNumber.trim() || undefined,
        emissionStandard: form.emissionStandard || undefined, // TfL Item 5
        isUlezCompliant: form.isUlezCompliant === "true", // TfL Item 5
      },
    };

    if (editing) {
      editDriver.mutate({ id: editing.id, payload });
    } else {
      addDriver.mutate(payload);
    }
  };

  const drivers: any[] = data?.items ?? data ?? [];
  const filtered = search
    ? drivers.filter(
        (d) =>
          `${d.user.firstName} ${d.user.lastName}`
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          d.pcoBadgeNumber.includes(search) ||
          d.vehicle?.licensePlate?.toLowerCase().includes(search.toLowerCase())
      )
    : drivers;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Drivers"
        subtitle={`${drivers.length} registered drivers`}
        action={
          <button
            onClick={() => {
              setShowAdd(true);
              setFormError("");
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-black text-sm font-semibold transition-colors"
          >
            <UserPlus size={15} />
            Add Driver
          </button>
        }
      />

      {/* Expiry alerts */}
      {expiringDocs?.length > 0 && (
        <div className="card p-4 border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-center gap-2 text-yellow-400 mb-3">
            <AlertTriangle size={14} />
            <span className="text-sm font-medium">
              {expiringDocs.length} documents expiring within 60 days
            </span>
          </div>
          <div className="space-y-1.5">
            {expiringDocs.slice(0, 3).map((doc: any) => (
              <div
                key={doc.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-400">
                  {doc.driver.user.firstName} {doc.driver.user.lastName} —{" "}
                  {doc.type.replace(/_/g, " ")}
                </span>
                <span className="text-yellow-400 font-medium">
                  Expires {format(new Date(doc.expiryDate), "dd MMM yyyy")}
                </span>
              </div>
            ))}
            {expiringDocs.length > 3 && (
              <p className="text-xs text-slate-600">
                +{expiringDocs.length - 3} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-9"
            placeholder="Search name, PCO badge, plate…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Driver",
              "PCO Badge",
              "Vehicle",
              "Status",
              "Rating",
              "Total Jobs",
              "PCO Expiry",
              "ULEZ",
              "Location",
            ]}
            isEmpty={!filtered.length}
            emptyMessage="No drivers found"
          >
            {filtered.map((d: any) => {
              const pcoExpiry = new Date(d.pcoLicenseExpiry);
              const daysUntil = Math.ceil(
                (pcoExpiry.getTime() - Date.now()) / 86400000
              );
              const isExpiringSoon = daysUntil <= 30;
              return (
                <tr
                  key={d.id}
                  className="table-row cursor-pointer"
                  onClick={() => setSelected(d)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-bold">
                        {d.user.firstName[0]}
                        {d.user.lastName[0]}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-white">
                          {d.user.firstName} {d.user.lastName}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {d.user.phone}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {d.pcoBadgeNumber}
                  </td>
                  <td className="px-4 py-3">
                    {d.vehicle ? (
                      <div>
                        <p className="text-xs text-white">
                          {d.vehicle.make} {d.vehicle.model}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {d.vehicle.licensePlate} · {d.vehicle.colour}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">No vehicle</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <DriverBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-brand-400 text-xs font-medium">
                      ★ {d.rating.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {d.totalJobs}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        isExpiringSoon ? "text-red-400" : "text-slate-400"
                      }`}
                    >
                      {isExpiringSoon && (
                        <AlertTriangle size={10} className="inline mr-1" />
                      )}
                      {format(pcoExpiry, "dd MMM yyyy")}
                    </span>
                  </td>
                  {/* TfL Item 5: ULEZ column */}
                  <td className="px-4 py-3">
                    {d.vehicle?.isUlezCompliant ? (
                      <span className="text-xs text-green-400 font-medium">
                        ✓ ULEZ
                      </span>
                    ) : d.vehicle ? (
                      <span className="text-xs text-red-400">✗ Non-ULEZ</span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.liveLocation ? (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />{" "}
                        Live
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {/* ── Add/Edit Driver Modal ── */}
      <Modal
        open={showAdd}
        onClose={() => {
          setShowAdd(false);
          setEditing(null);
          setForm(EMPTY_FORM);
        }}
        title={
          editing
            ? `Edit — ${editing?.user?.firstName} ${editing?.user?.lastName}`
            : "Add New Driver"
        }
      >
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* Personal */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Personal Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  First Name <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="John"
                  value={form.firstName}
                  onChange={set("firstName")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Last Name <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="Smith"
                  value={form.lastName}
                  onChange={set("lastName")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Phone <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="+447700900000"
                  value={form.phone}
                  onChange={set("phone")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Email
                </label>
                <input
                  className="input w-full"
                  placeholder="john@email.com"
                  value={form.email}
                  onChange={set("email")}
                />
              </div>
            </div>
          </div>

          {/* PCO */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              PCO / Licence
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PCO Badge No. <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="PCO123456"
                  value={form.pcoBadgeNumber}
                  onChange={set("pcoBadgeNumber")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PCO Expiry <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={form.pcoLicenseExpiry}
                  onChange={set("pcoLicenseExpiry")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Driving Licence No. <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="SMITH123456AB9CD"
                  value={form.drivingLicenseNumber}
                  onChange={set("drivingLicenseNumber")}
                />
              </div>
            </div>
          </div>

          {/* Vehicle */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Vehicle
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Make <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="Toyota"
                  value={form.make}
                  onChange={set("make")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Model <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="Prius"
                  value={form.model}
                  onChange={set("model")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Year
                </label>
                <input
                  className="input w-full"
                  placeholder="2022"
                  value={form.year}
                  onChange={set("year")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Colour
                </label>
                <input
                  className="input w-full"
                  placeholder="Black"
                  value={form.colour}
                  onChange={set("colour")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Licence Plate <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full font-mono uppercase"
                  placeholder="AB12 CDE"
                  value={form.licensePlate}
                  onChange={set("licensePlate")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Class
                </label>
                <select
                  className="input w-full"
                  value={form.vehicleClass}
                  onChange={set("vehicleClass")}
                >
                  {VEHICLE_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Seats
                </label>
                <input
                  className="input w-full"
                  placeholder="4"
                  value={form.seats}
                  onChange={set("seats")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  MOT Expiry <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={form.motExpiry}
                  onChange={set("motExpiry")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Insurance Expiry <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={form.insuranceExpiry}
                  onChange={set("insuranceExpiry")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PHV Licence No.
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="452689"
                  value={form.phvLicenceNumber}
                  onChange={set("phvLicenceNumber")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PHV Licence Expiry
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={form.phvLicenceExpiry}
                  onChange={set("phvLicenceExpiry")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PHV Disc No.
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="1087796"
                  value={form.phvDiscNumber}
                  onChange={set("phvDiscNumber")}
                />
              </div>
            </div>
          </div>

          {/* TfL Item 5: ULEZ / Emission */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Emissions & ULEZ
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Emission Standard
                </label>
                <select
                  className="input w-full"
                  value={form.emissionStandard}
                  onChange={set("emissionStandard")}
                >
                  {EMISSION_STANDARDS.map((s) => (
                    <option key={s} value={s}>
                      {s || "Not specified"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  ULEZ Compliant
                </label>
                <select
                  className="input w-full"
                  value={form.isUlezCompliant}
                  onChange={set("isUlezCompliant")}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">
              ULEZ compliance required for vehicles operating in the London
              Ultra Low Emission Zone.
            </p>
          </div>
        </div>

        {formError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-3">
            {formError}
          </p>
        )}

        <div className="flex gap-3 pt-3">
          <button
            onClick={() => setShowAdd(false)}
            className="flex-1 btn-ghost py-2.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={addDriver.isPending || editDriver.isPending}
            className="flex-2 flex-1 px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
          >
            {addDriver.isPending || editDriver.isPending
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
              ? "Save Changes"
              : "Create Driver"}
          </button>
        </div>
      </Modal>

      {/* Driver detail modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          selected ? `${selected.user.firstName} ${selected.user.lastName}` : ""
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => openEdit(selected)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500 transition-colors"
              >
                <Pencil size={12} /> Edit
              </button>
              <button
                onClick={() => setDeleteId(selected.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Status",
                  value: <DriverBadge status={selected.status} />,
                },
                {
                  label: "PCO Badge",
                  value: (
                    <span className="font-mono">{selected.pcoBadgeNumber}</span>
                  ),
                },
                { label: "Rating", value: `★ ${selected.rating.toFixed(1)}` },
                { label: "Total Jobs", value: selected.totalJobs },
                {
                  label: "Onboarded",
                  value: selected.onboardingComplete ? "✓ Yes" : "✗ Pending",
                },
                {
                  label: "PCO Expiry",
                  value: format(
                    new Date(selected.pcoLicenseExpiry),
                    "dd MMM yyyy"
                  ),
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]"
                >
                  <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                  <div className="text-xs text-[var(--text)] font-medium">
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {selected.vehicle && (
              <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                <p className="text-[10px] text-slate-500 mb-2">Vehicle</p>
                <p className="text-sm text-[var(--text)] font-medium">
                  {selected.vehicle.year} {selected.vehicle.make}{" "}
                  {selected.vehicle.model} · {selected.vehicle.colour}
                </p>
                <div className="flex gap-4 mt-1 text-xs text-slate-500 flex-wrap">
                  <span>
                    Plate:{" "}
                    <span className="font-mono text-slate-300">
                      {selected.vehicle.licensePlate}
                    </span>
                  </span>
                  <span>Class: {selected.vehicle.class}</span>
                  <span>Seats: {selected.vehicle.seats}</span>
                </div>
                {/* TfL Item 5: Emissions display */}
                <div className="flex gap-4 mt-2 text-xs flex-wrap">
                  {selected.vehicle.emissionStandard && (
                    <span className="text-slate-400">
                      Emission:{" "}
                      <span className="text-slate-200">
                        {selected.vehicle.emissionStandard}
                      </span>
                    </span>
                  )}
                  <span
                    className={
                      selected.vehicle.isUlezCompliant
                        ? "text-green-400 font-medium"
                        : "text-red-400"
                    }
                  >
                    {selected.vehicle.isUlezCompliant
                      ? "✓ ULEZ Compliant"
                      : "✗ Non-ULEZ"}
                  </span>
                </div>
              </div>
            )}
            {selected.documents?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2">Documents</p>
                <div className="space-y-1.5">
                  {selected.documents.map((doc: any) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between text-xs p-2 rounded bg-[var(--card-hover)]"
                    >
                      <span className="text-slate-300">
                        {doc.type.replace(/_/g, " ")}
                      </span>
                      {doc.expiryDate && (
                        <span className="text-slate-500">
                          {format(new Date(doc.expiryDate), "dd MMM yyyy")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Driver"
      >
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          Are you sure you want to delete this driver? Their booking history
          will be preserved but their account will be removed. This cannot be
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
            onClick={() => deleteId && deleteDriver.mutate(deleteId)}
            disabled={deleteDriver.isPending}
            className="btn-danger flex items-center gap-2 text-sm"
          >
            {deleteDriver.isPending ? <Spinner size={14} /> : null} Delete
            Driver
          </button>
        </div>
      </Modal>
    </div>
  );
}
