"use client";
// admin/src/app/(admin)/tfl-records/page.tsx
//
// TfL Records: pick a driver, a vehicle or a lost property item and see the record in TfL's
// template ("PRIVATE HIRE DRIVER" / "VEHICLE DETAILS" / "LOST/FOUND PROPERTY"), ready to show an
// inspector or print / save as PDF; or print the lost property register for a period.
// Drivers: current + left within 12 months. Vehicles: fleet + ceased within 12 months.
// The selection is in the address (?driver=<id>, ?vehicle=<id>, ?item=<id>; ?tab=vehicles /
// ?tab=lost-property for the tab), so refresh / bookmark / the links on other pages land on it.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, Printer, RefreshCw, ExternalLink, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { SectionHeader, Spinner } from "@/components/ui";
import { TflDriverRecord } from "@/components/TflDriverRecord";
import { TflVehicleRecord } from "@/components/TflVehicleRecord";
import { TflLostPropertyRecord, TflLostPropertyRegister } from "@/components/TflLostPropertyRecord";
import { LP_STATUS, refreshLostProperty } from "@/components/LostProperty";
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
  const tab =
    params.get("vehicle") || params.get("tab") === "vehicles"
      ? "vehicles"
      : params.get("item") || params.get("tab") === "lost-property"
        ? "lost-property"
        : "drivers";
  const TABS = [
    { id: "drivers", label: "Drivers", href: "/tfl-records" },
    { id: "vehicles", label: "Vehicles", href: "/tfl-records?tab=vehicles" },
    { id: "lost-property", label: "Lost property", href: "/tfl-records?tab=lost-property" },
  ] as const;
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="no-print">
        <SectionHeader
          title="TfL Records"
          subtitle="Records in TfL's formats — drivers, vehicles and lost property, kept for 12 months after they end"
        />
        <div className="flex gap-1 mt-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => router.replace(t.href)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-brand-500 text-black"
                  : "border border-[var(--border)] text-slate-400 hover:text-white hover:border-brand-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "drivers" ? <DriverRecords /> : tab === "vehicles" ? <VehicleRecords /> : <LostPropertyRecords />}
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

// ── Lost property ────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" in UK time, n months before today (n = 0 → today). */
function ukDayKey(monthsBack = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsBack);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function LostPropertyRecords() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const itemId = params.get("item") ?? "";
  const [view, setView] = useState<"record" | "register">(itemId ? "record" : "register");
  const [from, setFrom] = useState(ukDayKey(12));
  const [to, setTo] = useState(ukDayKey(0));
  const [confirmRef, setConfirmRef] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const { data: items = [], isLoading } = useQuery<any[]>({
    queryKey: ["lost-property"],
    queryFn: () => api.get("/admin/lost-property").then((r) => r.data.data),
  });
  const record = useQuery({
    queryKey: ["tfl-lost-property", itemId],
    queryFn: () => api.get(`/admin/lost-property/${itemId}/tfl-record`).then((r) => r.data.data),
    enabled: view === "record" && !!itemId,
    refetchOnWindowFocus: false,
  });
  const register = useQuery({
    queryKey: ["tfl-lost-property-register", from, to],
    queryFn: () =>
      api.get("/admin/tfl-records/lost-property", { params: { from: from || undefined, to: to || undefined } }).then((r) => r.data.data),
    enabled: view === "register",
    refetchOnWindowFocus: false,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/lost-property/${itemId}`, { data: { confirmRef } }),
    onSuccess: () => {
      toast.success(`${rec?.item.refNo} deleted`);
      refreshLostProperty(qc);
      setConfirmRef("");
      router.replace("/tfl-records?tab=lost-property");
      setView("register");
    },
    onError: (err: any) => setDeleteError(err?.response?.data?.error ?? "Could not delete"),
  });

  const choose = (id: string) => {
    setView("record");
    setConfirmRef("");
    setDeleteError("");
    router.replace(id ? `/tfl-records?item=${id}` : "/tfl-records?tab=lost-property");
  };
  const open = items.filter((i) => i.status === "REPORTED" || i.status === "FOUND");
  const closed = items.filter((i) => i.status === "RETURNED" || i.status === "CLOSED");
  const label = (i: any) =>
    `${i.refNo} — ${String(i.description).slice(0, 40)}${String(i.description).length > 40 ? "…" : ""} — ${LP_STATUS[i.status]?.label ?? i.status}`;
  const rec = record.data;
  const ready = view === "record" ? !!rec : !!register.data;
  const viewBtn = (v: "record" | "register", text: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
        view === v ? "border-brand-500 text-white" : "border-[var(--border)] text-slate-400 hover:text-white"
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-center gap-3 no-print">
        {viewBtn("register", "Register")}
        {viewBtn("record", "One item")}
        {view === "record" ? (
          <select
            className="input flex-1 min-w-[260px]"
            value={itemId}
            onChange={(e) => choose(e.target.value)}
            disabled={isLoading}
            aria-label="Lost property item"
          >
            <option value="">{isLoading ? "Loading…" : "Choose an item…"}</option>
            {open.length > 0 && (
              <optgroup label="Open">
                {open.map((i) => (
                  <option key={i.id} value={i.id}>{label(i)}</option>
                ))}
              </optgroup>
            )}
            {closed.length > 0 && (
              <optgroup label="Closed">
                {closed.map((i) => (
                  <option key={i.id} value={i.id}>{label(i)}</option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <label className="text-xs text-slate-400 flex items-center gap-1.5">
              From <input type="date" className="input py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-xs text-slate-400 flex items-center gap-1.5">
              To <input type="date" className="input py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
        {(view === "register" || itemId) && (
          <>
            <button
              onClick={() => (view === "record" ? record.refetch() : register.refetch())}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500"
            >
              <RefreshCw size={12} className={(view === "record" ? record : register).isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={() => window.print()}
              disabled={!ready}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-black text-sm font-semibold"
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </>
        )}
      </div>

      {view === "record" && rec && rec.warnings.length > 0 && (
        <div className="card p-4 border-amber-500/30 bg-amber-500/5 no-print">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Not filled in: {rec.warnings.join(", ")}
            </p>
            <a
              href={`/alerts?lost=${itemId}`}
              className="flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 whitespace-nowrap"
            >
              Update on Alerts <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}
      {view === "record" && rec?.item.overdue && (
        <div className="card p-4 border-amber-500/30 bg-amber-500/5 no-print text-xs text-amber-400">
          Open for {rec.item.daysOpen} days — consider handing it to the police or disposing of it, and record the result.
        </div>
      )}

      {view === "register" ? (
        register.isLoading ? (
          <div className="flex justify-center py-16 no-print"><Spinner size={24} /></div>
        ) : register.isError || !register.data ? (
          <div className="card p-10 text-center text-sm text-red-400 no-print">Could not load the register.</div>
        ) : (
          <TflLostPropertyRegister data={register.data} />
        )
      ) : !itemId ? (
        <div className="card p-10 text-center text-sm text-slate-500 no-print">Choose an item to see its TfL record.</div>
      ) : record.isLoading ? (
        <div className="flex justify-center py-16 no-print"><Spinner size={24} /></div>
      ) : record.isError || !rec ? (
        <div className="card p-10 text-center text-sm text-red-400 no-print">Could not load this item&apos;s record.</div>
      ) : (
        <>
          <TflLostPropertyRecord data={rec} />
          <div className="card p-4 no-print text-xs text-slate-400">
            {rec.item.canDelete ? (
              <div className="space-y-2">
                <p>Closed more than 12 months ago — this record can be deleted permanently. Type <span className="font-mono text-white">{rec.item.refNo}</span> to confirm.</p>
                <div className="flex flex-wrap gap-2">
                  <input className="input py-1.5 font-mono uppercase" value={confirmRef} onChange={(e) => setConfirmRef(e.target.value)} aria-label="Type the ref to confirm" />
                  <button
                    onClick={() => { setDeleteError(""); remove.mutate(); }}
                    disabled={confirmRef.trim().toUpperCase() !== rec.item.refNo || remove.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white"
                  >
                    <Trash2 size={12} /> Delete permanently
                  </button>
                </div>
                {deleteError && <p className="text-red-400">{deleteError}</p>}
              </div>
            ) : rec.item.deletableFrom ? (
              <p>Kept until {rec.item.deletableFrom} (12 months after closing); it can be deleted from then.</p>
            ) : (
              <p>Open items are kept; once closed, the record is kept for 12 months.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
