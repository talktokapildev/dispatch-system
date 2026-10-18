"use client";
// admin/src/app/(admin)/tfl-records/page.tsx
//
// TfL Records: pick a driver and see their record in TfL's "PRIVATE HIRE DRIVER" template, ready
// to show an inspector or print / save as PDF. Current drivers plus drivers who left within the
// last 12 months (TfL keeps-records period). The selected driver is in the address
// (?driver=<id>), so refresh / bookmark / the "TfL record" button on Drivers land on it.
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Printer, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { SectionHeader, Spinner } from "@/components/ui";
import { TflDriverRecord } from "@/components/TflDriverRecord";
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
    <div className="space-y-5 animate-fade-in">
      <div className="no-print">
        <SectionHeader
          title="TfL Records"
          subtitle="Driver records in TfL's Private Hire Driver format — current drivers and those who left within 12 months"
        />
      </div>

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
