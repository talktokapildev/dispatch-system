"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Modal } from "@/components/ui";
import { AddressPicker } from "@/components/AddressPicker";
import toast from "react-hot-toast";
import { PoundSterling, Plane, Clock, AlertCircle } from "lucide-react";

const CAR_FEATURES = [
  "Baby Seat",
  "Wheelchair Access",
  "Pet Friendly",
  "Large Boot",
  "Electric Vehicle",
];
const DRIVER_FEATURES = [
  "Female Driver",
  "Speaks Arabic",
  "Speaks Urdu",
  "Speaks French",
  "Experienced Airport",
];
const ZONES = [
  "Zone 1",
  "Zone 2",
  "Zone 3",
  "Zone 4",
  "Zone 5",
  "Zone 6",
  "Gatwick",
  "Heathrow",
  "Stansted",
  "Luton",
];
const PAYMENT_METHODS = ["CARD", "CASH", "APPLE_PAY", "GOOGLE_PAY", "ACCOUNT"];
const VEHICLE_CLASSES = ["STANDARD", "EXECUTIVE", "MPV", "MINIBUS"];
const BOOKING_TYPES = [
  "ASAP",
  "PREBOOKED",
  "AIRPORT_PICKUP",
  "AIRPORT_DROPOFF",
  "CORPORATE",
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewBookingModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    // Passenger
    passengerPhone: "",
    passengerName: "",
    passengerEmail: "",
    // Trip
    type: "ASAP",
    pickupAddress: "",
    pickupLatitude: 51.5074,
    pickupLongitude: -0.1278,
    pickupZone: "",
    dropoffAddress: "",
    dropoffLatitude: 51.5074,
    dropoffLongitude: -0.1278,
    dropoffZone: "",
    scheduledAt: "",
    allocationTime: "",
    isOnHold: false,
    // Pricing
    pricingType: "FIXED",
    paymentMethod: "CARD",
    fixedPriceOverride: "",
    vehicleClass: "STANDARD",
    passengerCount: "1",
    department: "",
    // Flight
    flightNumber: "",
    flightArrivalTime: "",
    terminal: "",
    // Notes
    notes: "",
    operatorNotes: "",
    // Features
    requiredCarFeatures: [] as string[],
    requiredDriverFeatures: [] as string[],
  });

  const set = (key: string, val: any) => setForm((f) => ({ ...f, [key]: val }));

  const toggleFeature = (
    list: "requiredCarFeatures" | "requiredDriverFeatures",
    val: string
  ) => {
    setForm((f) => ({
      ...f,
      [list]: f[list].includes(val)
        ? f[list].filter((x: string) => x !== val)
        : [...f[list], val],
    }));
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/admin/bookings", {
        ...form,
        passengerCount: parseInt(form.passengerCount),
        fixedPriceOverride: form.fixedPriceOverride
          ? parseFloat(form.fixedPriceOverride)
          : undefined,
        scheduledAt: form.scheduledAt || undefined,
        allocationTime: form.allocationTime || undefined,
        flightArrivalTime: form.flightArrivalTime || undefined,
      }),
    onSuccess: () => {
      toast.success("Booking created successfully");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
      setStep(1);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? "Failed to create booking");
    },
  });

  const isAirport =
    form.type === "AIRPORT_PICKUP" || form.type === "AIRPORT_DROPOFF";

  return (
    <Modal open={open} onClose={onClose} title="New Booking">
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {/* Step indicator */}
        <div className="flex gap-1">
          {["Passenger", "Trip", "Pricing", "Options"].map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i + 1)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-all ${
                step === i + 1
                  ? "bg-brand-500 text-black"
                  : "bg-[var(--table-hover)] text-slate-500 hover:text-white"
              }`}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        {/* ── Step 1: Passenger ── */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
              Passenger Details
            </p>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Phone Number *
              </label>
              <input
                className="input"
                placeholder="+447123456789"
                value={form.passengerPhone}
                onChange={(e) => set("passengerPhone", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Full Name
                </label>
                <input
                  className="input"
                  placeholder="John Smith"
                  value={form.passengerName}
                  onChange={(e) => set("passengerName", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Email
                </label>
                <input
                  className="input"
                  type="email"
                  placeholder="john@example.com"
                  value={form.passengerEmail}
                  onChange={(e) => set("passengerEmail", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Passengers
                </label>
                <select
                  className="input"
                  value={form.passengerCount}
                  onChange={(e) => set("passengerCount", e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Department (Corporate)
                </label>
                <input
                  className="input"
                  placeholder="e.g. Finance"
                  value={form.department}
                  onChange={(e) => set("department", e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setStep(2)} className="btn-primary">
                Next: Trip Details →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Trip ── */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
              Trip Details
            </p>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Booking Type *
              </label>
              <div className="flex gap-1 flex-wrap">
                {BOOKING_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => set("type", t)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all border ${
                      form.type === t
                        ? "bg-brand-500 text-black border-brand-500"
                        : "border-[var(--border)] text-slate-400 hover:text-white"
                    }`}
                  >
                    {t.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Pickup */}
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] space-y-2">
              <p className="text-xs text-green-400 font-medium">↑ Pickup</p>
              <AddressPicker
                value={form.pickupAddress}
                onChange={(address, lat, lng) =>
                  setForm((f) => ({
                    ...f,
                    pickupAddress: address,
                    pickupLatitude: lat,
                    pickupLongitude: lng,
                  }))
                }
                placeholder="Search pickup address..."
              />
              <select
                className="input"
                value={form.pickupZone}
                onChange={(e) => set("pickupZone", e.target.value)}
              >
                <option value="">Select Zone (optional)</option>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            {/* Dropoff */}
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] space-y-2">
              <p className="text-xs text-red-400 font-medium">↓ Dropoff</p>
              <AddressPicker
                value={form.dropoffAddress}
                onChange={(address, lat, lng) =>
                  setForm((f) => ({
                    ...f,
                    dropoffAddress: address,
                    dropoffLatitude: lat,
                    dropoffLongitude: lng,
                  }))
                }
                placeholder="Search dropoff address..."
              />
              <select
                className="input"
                value={form.dropoffZone}
                onChange={(e) => set("dropoffZone", e.target.value)}
              >
                <option value="">Select Zone (optional)</option>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            {/* Timing */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {form.type === "ASAP"
                    ? "Scheduled At (leave blank = now)"
                    : "Pickup Date & Time *"}
                </label>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => set("scheduledAt", e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                  <Clock size={10} /> Allocation Time (delay dispatch)
                </label>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.allocationTime}
                  onChange={(e) => set("allocationTime", e.target.value)}
                />
              </div>
            </div>

            {/* On Hold */}
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-[var(--border)] hover:border-brand-500/30 transition-all">
              <div
                onClick={() => set("isOnHold", !form.isOnHold)}
                className={`w-10 h-5 rounded-full transition-all relative cursor-pointer ${
                  form.isOnHold ? "bg-brand-500" : "bg-white/10"
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${
                    form.isOnHold ? "left-5" : "left-0.5"
                  }`}
                />
              </div>
              <div>
                <p className="text-xs text-[var(--text)] font-medium">
                  On Hold
                </p>
                <p className="text-[10px] text-slate-500">
                  Booking created but not dispatched until released
                </p>
              </div>
            </label>

            {/* Airport fields */}
            {isAirport && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 space-y-2">
                <p className="text-xs text-blue-400 font-medium flex items-center gap-1">
                  <Plane size={11} /> Flight Details
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    className="input"
                    placeholder="Flight no. e.g. BA123"
                    value={form.flightNumber}
                    onChange={(e) => set("flightNumber", e.target.value)}
                  />
                  <input
                    className="input"
                    type="datetime-local"
                    placeholder="Arrival time"
                    value={form.flightArrivalTime}
                    onChange={(e) => set("flightArrivalTime", e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Terminal"
                    value={form.terminal}
                    onChange={(e) => set("terminal", e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="btn-ghost">
                ← Back
              </button>
              <button onClick={() => setStep(3)} className="btn-primary">
                Next: Pricing →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Pricing ── */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
              Pricing & Payment
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Pricing Type
                </label>
                <div className="flex gap-1">
                  {["FIXED", "METERED"].map((t) => (
                    <button
                      key={t}
                      onClick={() => set("pricingType", t)}
                      className={`flex-1 py-2 rounded text-xs font-medium transition-all border ${
                        form.pricingType === t
                          ? "bg-brand-500 text-black border-brand-500"
                          : "border-[var(--border)] text-slate-400 hover:text-white"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Vehicle Class
                </label>
                <select
                  className="input"
                  value={form.vehicleClass}
                  onChange={(e) => set("vehicleClass", e.target.value)}
                >
                  {VEHICLE_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                <PoundSterling size={10} /> Fixed Price Override (leave blank to
                use calculated fare)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                  £
                </span>
                <input
                  className="input pl-7"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 25.00"
                  value={form.fixedPriceOverride}
                  onChange={(e) => set("fixedPriceOverride", e.target.value)}
                />
              </div>
              {form.fixedPriceOverride && (
                <p className="text-xs text-brand-400 mt-1">
                  ✓ Fixed price of £
                  {parseFloat(form.fixedPriceOverride).toFixed(2)} will be
                  charged
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Payment Method
              </label>
              <div className="flex gap-1 flex-wrap">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => set("paymentMethod", m)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all border ${
                      form.paymentMethod === m
                        ? "bg-brand-500 text-black border-brand-500"
                        : "border-[var(--border)] text-slate-400 hover:text-white"
                    }`}
                  >
                    {m.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(2)} className="btn-ghost">
                ← Back
              </button>
              <button onClick={() => setStep(4)} className="btn-primary">
                Next: Options →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Options ── */}
        {step === 4 && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
              Additional Options
            </p>

            {/* Car features */}
            <div>
              <label className="text-xs text-slate-400 block mb-2">
                Required Car Features
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {CAR_FEATURES.map((f) => (
                  <button
                    key={f}
                    onClick={() => toggleFeature("requiredCarFeatures", f)}
                    className={`px-3 py-1.5 rounded-full text-xs transition-all border ${
                      form.requiredCarFeatures.includes(f)
                        ? "bg-brand-500/20 text-brand-400 border-brand-500/40"
                        : "border-[var(--border)] text-slate-500 hover:text-white"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Driver features */}
            <div>
              <label className="text-xs text-slate-400 block mb-2">
                Required Driver Features
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {DRIVER_FEATURES.map((f) => (
                  <button
                    key={f}
                    onClick={() => toggleFeature("requiredDriverFeatures", f)}
                    className={`px-3 py-1.5 rounded-full text-xs transition-all border ${
                      form.requiredDriverFeatures.includes(f)
                        ? "bg-violet-500/20 text-violet-400 border-violet-500/40"
                        : "border-[var(--border)] text-slate-500 hover:text-white"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Driver Notes (visible to driver)
              </label>
              <textarea
                className="input resize-none h-16"
                placeholder="e.g. Passenger needs help with luggage, ring doorbell..."
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1 flex items-center gap-1">
                <AlertCircle size={10} /> Operator Notes (private — not visible
                to driver or passenger)
              </label>
              <textarea
                className="input resize-none h-16"
                placeholder="Internal notes for dispatch team..."
                value={form.operatorNotes}
                onChange={(e) => set("operatorNotes", e.target.value)}
              />
            </div>

            {/* Summary */}
            <div className="p-4 rounded-lg bg-[var(--card-hover)] border border-brand-500/20 space-y-2">
              <p className="text-xs text-brand-400 font-semibold">
                Booking Summary
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-500">Type</span>
                <span className="text-white">
                  {form.type.replace(/_/g, " ")}
                </span>
                <span className="text-slate-500">Pickup</span>
                <span className="text-[var(--text)] truncate">
                  {form.pickupAddress || "—"}
                </span>
                <span className="text-slate-500">Dropoff</span>
                <span className="text-[var(--text)] truncate">
                  {form.dropoffAddress || "—"}
                </span>
                <span className="text-slate-500">Payment</span>
                <span className="text-white">
                  {form.paymentMethod.replace(/_/g, " ")}
                </span>
                <span className="text-slate-500">Price</span>
                <span className="text-brand-400 font-semibold">
                  {form.fixedPriceOverride
                    ? `£${parseFloat(form.fixedPriceOverride).toFixed(
                        2
                      )} (fixed)`
                    : "Auto-calculated"}
                </span>
                {form.isOnHold && (
                  <>
                    <span className="text-slate-500">Status</span>
                    <span className="text-yellow-400">On Hold</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(3)} className="btn-ghost">
                ← Back
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={
                  mutation.isPending ||
                  !form.pickupAddress ||
                  !form.dropoffAddress ||
                  !form.passengerPhone
                }
                className="btn-primary px-6"
              >
                {mutation.isPending ? "Creating…" : "✓ Create Booking"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
