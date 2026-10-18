"use client";
// admin/src/app/(admin)/tfl-records/page.tsx
//
// TfL Records: pick a driver or a vehicle and see the record in TfL's template ("PRIVATE HIRE
// DRIVER" / "VEHICLE DETAILS"), ready to show an inspector or print / save as PDF.
// Drivers: current + left within 12 months. Vehicles: fleet + ceased within 12 months.
// The selection is in the address (?driver=<id> or ?vehicle=<id>; ?tab=vehicles for the tab),
// so refresh / bookmark / the links on Drivers and Vehicles land on it.
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Printer, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { SectionHeader, Spinner } from "@/components/ui";
import { TflDriverRecord } from "@/components/TflDriverRecord";
import { TflVehicleRecord } from "@/components/TflVehicleRecord";
import { dayText } from "@/components/DriverRegister";

type Row = {
  id: string;
  name: string;
  callSign: string | null;
  vehicleReg: string | null;
  left: boolean;
  leftOn: string | null;
  keptUntil: string | null;
};

export default function TflRecordsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      }
    >
      <TflRecords />
    </Suspense>
  );
}

function TflRecords() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("vehicle") || params.get("tab") === "vehicles" ? "vehicles" : "drivers";
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="no-print">
        <SectionHeader
          title="TfL Records"
          subtitle="Records in TfL's formats — current drivers and vehicles, and those that left within 12 months"
        />
        <div className="flex gap-1 mt-4">
          {(["drivers", "vehicles"] as const).map((t) => (
            <button
              key={t}
              onClick={() => router.replace(t === "vehicles" ? "/tfl-records?tab=vehicles" : "/tfl-records")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-brand-500 text-black"
                  : "border border-[var(--border)] text-slate-400 hover:text-white hover:border-brand-500"
              }`}
            >
              {t === "drivers" ? "Drivers" : "Vehicles"}
            </button>
          ))}
        </div>
      </div>
      {tab === "drivers" ? <DriverRecords /> : <VehicleRecords />}
    </div>
  );
}

function DriverRecords() {
  const router = useRouter();
  const params = useSearchParams();
  const driverId = params.get("driver") ?? "";

  const { data: drivers = [], isLoading } = useQuery<Row[]>({
    queryKey: ["tfl-record-drivers"],
    queryFn: () => api.get("/admin/tfl-records/drivers").then((r) => r.data.data),
  });
  const record = useQuery({
    queryKey: ["tfl-record", driverId],
    queryFn: () => api.get(`/admin/drivers/${driverId}/tfl-record`).then((r) => r.data.data),
    enabled: !!driverId,
    refetchOnWindowFocus: false,
  });
  const register = useQuery({
    queryKey: ["driver-register", driverId],
    queryFn: () => api.get(`/admin/drivers/${driverId}/register`).then((r) => r.data.data),
    enabled: !!driverId,
  });

  const choose = (id: string) => router.replace(id ? `/tfl-records?driver=${id}` : "/tfl-records");
  const current = drivers.filter((d) => !d.left);
  const left = drivers.filter((d) => d.left);
  const label = (d: Row) =>
    d.left
      ? `${d.name} — left ${dayText(d.leftOn)}`
      : `${d.name} — ${d.vehicleReg ?? "no vehicle"}${d.callSign ? ` (${d.callSign})` : ""}`;

  // Not printed: what's missing or out of date on this record
  const rec = record.data;
  const reg = register.data;
  const warnings: string[] = [];
  if (reg?.warnings.missing.length) warnings.push(`Missing: ${reg.warnings.missing.join(", ")}`);
  if (rec?.checks.photoMissing) warnings.push("No profile photo");
  if (rec && !rec.driver.callSign) warnings.push("No call sign");
  for (const e of rec?.enclosures ?? [])
    for (const p of e.parts) if (!p.pages.length) warnings.push(`No approved copy of the ${p.label.toLowerCase()} on file`);
  if (rec?.checks.licenceCheckDue)
    warnings.push(rec.checks.licenceCheckedAt ? `DVLA licence check due (last ${rec.checks.licenceCheckedAt})` : "DVLA licence check not recorded");
  if (rec && !rec.archived && (!rec.checks.insurance || rec.checks.insurance.state !== "valid"))
    warnings.push("Hire & reward insurance not in order for the current vehicle");
  if (reg?.warnings.underAge) warnings.push(`Under 21 (age ${reg.warnings.age})`);

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-center gap-3 no-print">
        <select
          className="input flex-1 min-w-[260px]"
          value={driverId}
          onChange={(e) => choose(e.target.value)}
          disabled={isLoading}
          aria-label="Driver"
        >
          <option value="">{isLoading ? "Loading drivers…" : "Choose a driver…"}</option>
          {current.length > 0 && (
            <optgroup label="Current drivers">
              {current.map((d) => (
                <option key={d.id} value={d.id}>{label(d)}</option>
              ))}
            </optgroup>
          )}
          {left.length > 0 && (
            <optgroup label="Left (records kept for 12 months)">
              {left.map((d) => (
                <option key={d.id} value={d.id}>
                  {label(d)}
                  {d.keptUntil ? ` · kept until ${dayText(d.keptUntil)}` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {driverId && (
          <>
            <button
              onClick={() => record.refetch()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500"
              title="Reload (document links expire after 10 minutes)"
            >
              <RefreshCw size={12} className={record.isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={() => window.print()}
              disabled={!rec}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-black text-sm font-semibold"
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </>
        )}
      </div>

      {driverId && warnings.length > 0 && (
        <div className="card p-4 border-amber-500/30 bg-amber-500/5 no-print">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              {warnings.map((w) => (
                <p key={w} className="text-xs text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
            <a
              href={`/drivers?open=${driverId}`}
              className="flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 whitespace-nowrap"
            >
              Edit on Drivers page <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      {!driverId ? (
        <div className="card p-10 text-center text-sm text-slate-500 no-print">
          Choose a driver to see their TfL record.
        </div>
      ) : record.isLoading ? (
        <div className="flex justify-center py-16 no-print">
          <Spinner size={24} />
        </div>
      ) : record.isError || !rec ? (
        <div className="card p-10 text-center text-sm text-red-400 no-print">
          Could not load this driver&apos;s record.
        </div>
      ) : (
        <TflDriverRecord data={rec} />
      )}
    </div>
  );
}

// ── Vehicles ─────────────────────────────────────────────────────────────────

type VRow = {
  id: string;
  registration: string;
  makeModel: string;
  driverName: string | null;
  retired: boolean;
  ceasedOn: string | null;
  keptUntil: string | null;
};

function VehicleRecords() {
  const router = useRouter();
  const params = useSearchParams();
  const vehicleId = params.get("vehicle") ?? "";

  const { data: vehicles = [], isLoading } = useQuery<VRow[]>({
    queryKey: ["tfl-record-vehicles"],
    queryFn: () => api.get("/admin/tfl-records/vehicles").then((r) => r.data.data),
  });
  const record = useQuery({
    queryKey: ["tfl-vehicle-record", vehicleId],
    queryFn: () => api.get(`/admin/vehicles/${vehicleId}/tfl-record`).then((r) => r.data.data),
    enabled: !!vehicleId,
    refetchOnWindowFocus: false,
  });

  const choose = (id: string) => router.replace(id ? `/tfl-records?vehicle=${id}` : "/tfl-records?tab=vehicles");
  const fleet = vehicles.filter((v) => !v.retired);
  const ceased = vehicles.filter((v) => v.retired);
  const label = (v: VRow) =>
    `${v.registration} — ${v.makeModel}${v.retired ? ` — ceased ${dayText(v.ceasedOn)}` : ` (${v.driverName ?? "unassigned"})`}`;

  const rec = record.data;
  const warnings: string[] = [];
  if (rec?.warnings.keeperNameMissing) warnings.push("Registered keeper's name missing");
  if (rec?.warnings.keeperAddressMissing) warnings.push("Registered keeper's address missing");
  for (const e of rec?.enclosures ?? [])
    if (!e.pages.length) warnings.push(`No approved copy of the ${e.label.replace(/^(?!MOT|PHV|V5C)\w/, (c: string) => c.toLowerCase())} on file`);
    else if (e.state === "expired") warnings.push(`${e.label} has expired`);

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-center gap-3 no-print">
        <select
          className="input flex-1 min-w-[260px]"
          value={vehicleId}
          onChange={(e) => choose(e.target.value)}
          disabled={isLoading}
          aria-label="Vehicle"
        >
          <option value="">{isLoading ? "Loading vehicles…" : "Choose a vehicle…"}</option>
          {fleet.length > 0 && (
            <optgroup label="On the fleet">
              {fleet.map((v) => (
                <option key={v.id} value={v.id}>{label(v)}</option>
              ))}
            </optgroup>
          )}
          {ceased.length > 0 && (
            <optgroup label="Ceased (records kept for 12 months)">
              {ceased.map((v) => (
                <option key={v.id} value={v.id}>
                  {label(v)}
                  {v.keptUntil ? ` · kept until ${dayText(v.keptUntil)}` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {vehicleId && (
          <>
            <button
              onClick={() => record.refetch()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500"
              title="Reload (document links expire after 10 minutes)"
            >
              <RefreshCw size={12} className={record.isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={() => window.print()}
              disabled={!rec}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-black text-sm font-semibold"
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </>
        )}
      </div>

      {vehicleId && warnings.length > 0 && (
        <div className="card p-4 border-amber-500/30 bg-amber-500/5 no-print">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              {warnings.map((w) => (
                <p key={w} className="text-xs text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
            <a
              href={`/vehicles?id=${vehicleId}`}
              className="flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 whitespace-nowrap"
            >
              Edit on Vehicles page <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      {!vehicleId ? (
        <div className="card p-10 text-center text-sm text-slate-500 no-print">
          Choose a vehicle to see its TfL record.
        </div>
      ) : record.isLoading ? (
        <div className="flex justify-center py-16 no-print">
          <Spinner size={24} />
        </div>
      ) : record.isError || !rec ? (
        <div className="card p-10 text-center text-sm text-red-400 no-print">
          Could not load this vehicle&apos;s record.
        </div>
      ) : (
        <TflVehicleRecord data={rec} />
      )}
    </div>
  );
}
