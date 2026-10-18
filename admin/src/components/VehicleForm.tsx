"use client";
// Vehicle details form (Vehicles page add/edit).
import type { Dispatch, SetStateAction } from "react";

export const VEHICLE_CLASSES = ["STANDARD", "EXECUTIVE", "MPV", "MINIBUS"];
export const EMISSION_STANDARDS = ["", "Euro 4", "Euro 5", "Euro 6", "Electric", "Hybrid", "Plug-in Hybrid"];

export const EMPTY_VEHICLE_FORM = {
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
  emissionStandard: "",
  isUlezCompliant: "false",
  notes: "",
  keeperName: "",
  keeperAddress: "",
  startDate: "", // "" on a new vehicle = today
};
export type VehicleForm = typeof EMPTY_VEHICLE_FORM;

const day = (iso?: string | null) => (iso ? iso.split("T")[0] : "");

export function vehicleFormFrom(v: any): VehicleForm {
  return {
    make: v.make ?? "",
    model: v.model ?? "",
    year: v.year?.toString() ?? "",
    colour: v.colour ?? "",
    licensePlate: v.licensePlate ?? "",
    vehicleClass: v.class ?? "STANDARD",
    seats: v.seats?.toString() ?? "4",
    motExpiry: day(v.motExpiry),
    insuranceExpiry: day(v.insuranceExpiry),
    phvLicenceNumber: v.phvLicenceNumber ?? "",
    phvLicenceExpiry: day(v.phvLicenceExpiry),
    phvDiscNumber: v.phvDiscNumber ?? "",
    emissionStandard: v.emissionStandard ?? "",
    isUlezCompliant: v.isUlezCompliant ? "true" : "false",
    notes: v.notes ?? "",
    keeperName: v.keeperName ?? "",
    keeperAddress: v.keeperAddress ?? "",
    startDate: day(v.startDate),
  };
}

export function vehiclePayload(f: VehicleForm) {
  return {
    make: f.make.trim(),
    model: f.model.trim(),
    year: parseInt(f.year) || new Date().getFullYear(),
    colour: f.colour.trim(),
    licensePlate: f.licensePlate.trim().toUpperCase(),
    class: f.vehicleClass,
    seats: parseInt(f.seats) || 4,
    motExpiry: f.motExpiry,
    insuranceExpiry: f.insuranceExpiry,
    phvLicenceNumber: f.phvLicenceNumber.trim() || null,
    phvLicenceExpiry: f.phvLicenceExpiry || null,
    phvDiscNumber: f.phvDiscNumber.trim() || null,
    emissionStandard: f.emissionStandard || null,
    isUlezCompliant: f.isUlezCompliant === "true",
    notes: f.notes.trim() || null,
    keeperName: f.keeperName.trim() || null,
    keeperAddress: f.keeperAddress.trim() || null,
    ...(f.startDate && { startDate: f.startDate }),
  };
}

const Label = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
  <label className="text-xs text-slate-400 mb-1 block">
    {children} {required && <span className="text-red-400">*</span>}
  </label>
);

export function VehicleFormFields({
  form,
  setForm,
}: {
  form: VehicleForm;
  setForm: Dispatch<SetStateAction<VehicleForm>>;
}) {
  const set =
    (key: keyof VehicleForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const text = (key: keyof VehicleForm, label: string, placeholder = "", opts: { required?: boolean; mono?: boolean; type?: string } = {}) => (
    <div>
      <Label required={opts.required}>{label}</Label>
      <input
        className={`input w-full ${opts.mono ? "font-mono" : ""} ${key === "licensePlate" ? "uppercase" : ""}`}
        placeholder={placeholder}
        type={opts.type ?? "text"}
        value={form[key]}
        onChange={set(key)}
      />
    </div>
  );

  return (
    <>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Vehicle</p>
        <div className="grid grid-cols-2 gap-3">
          {text("licensePlate", "Registration", "AB12 CDE", { required: true, mono: true })}
          {text("make", "Make", "Tesla", { required: true })}
          {text("model", "Model", "Model Y", { required: true })}
          {text("year", "Year", "2022")}
          {text("colour", "Colour", "White")}
          <div>
            <Label>Class</Label>
            <select className="input w-full" value={form.vehicleClass} onChange={set("vehicleClass")}>
              {VEHICLE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {text("seats", "Seats", "4")}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Licensing & expiry dates</p>
        <p className="text-[10px] text-slate-500 mb-3">
          Jobs are allowed by the approved documents, not these dates. Approving a new MOT, insurance or PHV
          licence document updates them automatically.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {text("motExpiry", "MOT expiry", "", { required: true, type: "date" })}
          {text("insuranceExpiry", "Insurance expiry", "", { required: true, type: "date" })}
          {text("phvLicenceNumber", "PHV licence no.", "452689", { mono: true })}
          {text("phvLicenceExpiry", "PHV licence expiry", "", { type: "date" })}
          {text("phvDiscNumber", "PHV disc no.", "1087796", { mono: true })}
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Emissions & ULEZ</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Emission standard</Label>
            <select className="input w-full" value={form.emissionStandard} onChange={set("emissionStandard")}>
              {EMISSION_STANDARDS.map((s) => (
                <option key={s} value={s}>
                  {s || "Not specified"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>ULEZ compliant</Label>
            <select className="input w-full" value={form.isUlezCompliant} onChange={set("isUlezCompliant")}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">TfL vehicle record</p>
        <div className="grid grid-cols-2 gap-3">
          {text("keeperName", "Registered keeper (V5C)", "Kapil Dev")}
          {text("startDate", "Start date (with OrangeRide)", "", { type: "date" })}
          <div className="col-span-2">
            <Label>Keeper address</Label>
            <textarea
              className="input w-full"
              rows={2}
              placeholder="As on the V5C logbook"
              value={form.keeperAddress}
              onChange={set("keeperAddress")}
            />
          </div>
        </div>
        <p className="text-[10px] text-slate-600 mt-2">
          Start date defaults to today. The ceased date is set when you retire the vehicle.
        </p>
      </div>

      <div>
        <Label>Notes</Label>
        <textarea
          className="input w-full"
          rows={2}
          placeholder="e.g. bought March 2025, finance with …"
          value={form.notes}
          onChange={set("notes")}
        />
      </div>
    </>
  );
}
