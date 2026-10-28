"use client";
// Documents: driver & vehicle documents across the fleet.
// Tabs: waiting for review, expiring (30 days), expired, approved without an expiry date,
// rejected, every approved version in force, and all documents. Review = approve with expiry
// date / reject with a reason (the driver is notified).
// Filter by one driver (their documents + their current car's) or one vehicle: kept in the URL
// as ?driver=<id> / ?vehicle=<id> (&tab=…), linked from the Drivers and Vehicles pages.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CarFront, ChevronDown, FileText, Search, User, X } from "lucide-react";
import { api } from "@/lib/api";
import { SectionHeader, Spinner, Table } from "@/components/ui";
import { DOC_LABELS, ExpiryText, ReviewModal, StateChip } from "@/components/Documents";

const TABS = [
  { key: "pending", label: "Waiting for review", count: "pending", badge: "bg-red-500 text-white" },
  { key: "expiring", label: "Expiring (30 days)", count: "expiring", badge: "bg-yellow-500 text-black" },
  { key: "expired", label: "Expired", count: "expired", badge: "bg-red-500 text-white" },
  { key: "expiry_needed", label: "No expiry date", count: "expiryNeeded", badge: "bg-orange-500 text-black" },
  { key: "rejected", label: "Rejected", count: null, badge: "" },
  { key: "current", label: "All approved", count: null, badge: "" },
  { key: "all", label: "All documents", count: null, badge: "" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Owner = { kind: "driver" | "vehicle"; id: string };
type Option = Owner & { label: string; sub: string; archived: boolean };

const fullName = (u: any) => `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim();

/** Keep ?driver= / ?vehicle= / ?tab= in the address bar without reloading. */
function writeUrl(owner: Owner | null, tab: TabKey) {
  const url = new URL(window.location.href);
  url.searchParams.delete("driver");
  url.searchParams.delete("vehicle");
  if (owner) url.searchParams.set(owner.kind, owner.id);
  if (tab === "pending") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  window.history.replaceState(null, "", url.toString());
}

export default function DocumentsPage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [ready, setReady] = useState(false);

  // Read the URL once
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t && TABS.some((x) => x.key === t)) setTab(t as TabKey);
    const d = p.get("driver");
    const v = p.get("vehicle");
    if (d) setOwner({ kind: "driver", id: d });
    else if (v) setOwner({ kind: "vehicle", id: v });
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) writeUrl(owner, tab);
  }, [owner, tab, ready]);

  const ownerParams = owner ? (owner.kind === "driver" ? { driverId: owner.id } : { vehicleId: owner.id }) : {};

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["docs", tab, owner?.kind ?? null, owner?.id ?? null],
    queryFn: () =>
      api.get("/admin/documents", { params: { view: tab, days: 30, ...ownerParams } }).then((r) => r.data.data),
    refetchInterval: 30_000,
    enabled: ready,
  });
  const { data: counts } = useQuery({
    queryKey: ["docs-counts", owner?.kind ?? null, owner?.id ?? null],
    queryFn: () => api.get("/admin/documents/counts", { params: ownerParams }).then((r) => r.data.data),
    refetchInterval: 60_000,
    enabled: ready,
  });

  // Picker options: drivers (with their current car) and vehicles, incl. archived / retired
  const { data: activeDrivers = [] } = useQuery({
    queryKey: ["doc-owner-drivers"],
    queryFn: () => api.get("/admin/drivers", { params: { limit: 200 } }).then((r) => r.data.data?.items ?? r.data.data ?? []),
  });
  const { data: archivedDrivers = [] } = useQuery({
    queryKey: ["doc-owner-drivers-archived"],
    queryFn: () =>
      api.get("/admin/drivers", { params: { limit: 200, status: "ARCHIVED" } }).then((r) => r.data.data?.items ?? r.data.data ?? []),
  });
  const { data: vehicles = [] } = useQuery({
    queryKey: ["doc-owner-vehicles"],
    queryFn: () => api.get("/admin/vehicles", { params: { status: "all" } }).then((r) => r.data.data?.items ?? []),
  });

  const options: Option[] = useMemo(() => {
    const drivers = [...activeDrivers, ...archivedDrivers].map((d: any) => ({
      kind: "driver" as const,
      id: d.id,
      label: fullName(d.user) || "Driver",
      sub: d.vehicle?.licensePlate ? `Car ${d.vehicle.licensePlate}` : "No car",
      archived: !!d.archivedAt,
    }));
    const cars = vehicles.map((v: any) => ({
      kind: "vehicle" as const,
      id: v.id,
      label: v.licensePlate,
      sub: [`${v.make ?? ""} ${v.model ?? ""}`.trim(), v.driver ? fullName(v.driver.user) : "Unassigned"]
        .filter(Boolean)
        .join(" · "),
      archived: !!v.archivedAt,
    }));
    const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label);
    return [...drivers.sort(byLabel), ...cars.sort(byLabel)];
  }, [activeDrivers, archivedDrivers, vehicles]);

  const chosen = owner ? options.find((o) => o.kind === owner.kind && o.id === owner.id) ?? null : null;

  const q = search.trim().toLowerCase();
  const shown = q
    ? docs.filter((d: any) =>
        [d.owner?.label, d.owner?.driverName, d.owner?.licensePlate, DOC_LABELS[d.type] ?? d.type, d.rejectionReason]
          .filter(Boolean)
          .some((t: string) => t.toLowerCase().includes(q))
      )
    : docs;

  const showExpiry = tab !== "rejected";
  const showStatusReason = tab === "all";
  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Documents"
        subtitle="Driver documents (PCO badge, licence, DBS) and vehicle documents (PHV licence, insurance, MOT, V5C). A driver gets jobs only when all are approved and in date."
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <OwnerPicker options={options} chosen={chosen} owner={owner} onChange={setOwner} />
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search name, reg, document…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {owner && <OwnerChecklist owner={owner} onOpen={setSelected} />}

      <div className="flex flex-wrap gap-1 p-1 bg-[var(--table-hover)] rounded-lg border border-[var(--border)] w-fit">
        {TABS.map((t) => {
          const n = t.count ? counts?.[t.count] ?? 0 : 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                tab === t.key ? "bg-brand-500 text-black" : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
              {n > 0 && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${t.badge}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        {isLoading || !ready ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={["Belongs to", "Document", "Uploaded", ...(showExpiry ? ["Expiry"] : ["Reason"]), "Status", ""]}
            isEmpty={!shown.length}
            emptyMessage={q ? "No documents match your search" : chosen ? `Nothing here for ${chosen.label}` : "Nothing here"}
          >
            {shown.map((doc: any) => (
              <tr key={doc.id} className="table-row cursor-pointer" onClick={() => setSelected(doc)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {doc.owner.kind === "vehicle" ? (
                      <CarFront size={13} className="text-slate-500" />
                    ) : (
                      <User size={13} className="text-slate-500" />
                    )}
                    <div>
                      <p className="text-xs text-[var(--text)]">
                        {doc.owner.kind === "vehicle" ? (
                          <span className="font-mono">{doc.owner.licensePlate}</span>
                        ) : (
                          doc.owner.driverName
                        )}
                      </p>
                      {doc.owner.kind === "vehicle" && (
                        <p className="text-[10px] text-slate-500">{doc.owner.driverName ?? "Unassigned"}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="text-slate-500" />
                    <span className="text-xs text-slate-300">{DOC_LABELS[doc.type] ?? doc.type}</span>
                    {doc.pages?.length > 1 && <span className="text-[10px] text-slate-500">({doc.pages.length} pages)</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{format(new Date(doc.createdAt), "dd MMM yyyy")}</td>
                {showExpiry ? (
                  <td className="px-4 py-3">
                    {doc.expiryDate ? (
                      <ExpiryText date={doc.expiryDate} daysLeft={doc.daysLeft} />
                    ) : showStatusReason && doc.status === "REJECTED" ? (
                      <span className="text-xs text-red-400 max-w-[240px] truncate inline-block align-bottom">
                        {doc.rejectionReason ?? "—"}
                      </span>
                    ) : doc.expiryRequired && doc.status === "APPROVED" ? (
                      <span className="text-xs text-orange-400">needed</span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                ) : (
                  <td className="px-4 py-3 text-xs text-red-400 max-w-[240px] truncate">{doc.rejectionReason ?? "—"}</td>
                )}
                <td className="px-4 py-3">
                  <StateChip state={doc.status} />
                </td>
                <td className="px-4 py-3 text-xs text-brand-400">
                  {doc.status === "PENDING" ? "Review →" : doc.status === "APPROVED" && !doc.expiryDate && doc.expiryRequired ? "Add date →" : "View →"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <ReviewModal doc={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/** Searchable "Driver or vehicle" picker. Archived drivers / retired cars behind a tick. */
function OwnerPicker({
  options,
  chosen,
  owner,
  onChange,
}: {
  options: Option[];
  chosen: Option | null;
  owner: Owner | null;
  onChange: (o: Owner | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const t = text.trim().toLowerCase();
  const visible = options.filter(
    (o) =>
      (showArchived || !o.archived || (owner && o.id === owner.id)) &&
      (!t || o.label.toLowerCase().includes(t) || o.sub.toLowerCase().includes(t))
  );
  const drivers = visible.filter((o) => o.kind === "driver");
  const cars = visible.filter((o) => o.kind === "vehicle");
  const pick = (o: Option | null) => {
    onChange(o ? { kind: o.kind, id: o.id } : null);
    setOpen(false);
    setText("");
  };
  const Icon = chosen?.kind === "vehicle" ? CarFront : User;

  return (
    <div ref={box} className="relative w-full sm:w-80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center gap-2 text-left w-full"
      >
        {chosen ? <Icon size={14} className="text-slate-500 shrink-0" /> : <Search size={14} className="text-slate-500 shrink-0" />}
        <span className={`flex-1 truncate text-sm ${chosen ? "text-[var(--text)]" : "text-slate-500"}`}>
          {chosen ? (
            <>
              <span className={chosen.kind === "vehicle" ? "font-mono" : ""}>{chosen.label}</span>
              <span className="text-slate-500 text-xs"> · {chosen.sub}</span>
            </>
          ) : owner ? (
            "Loading…"
          ) : (
            "All drivers and vehicles"
          )}
        </span>
        {owner ? (
          <span
            role="button"
            aria-label="Clear filter"
            onClick={(e) => {
              e.stopPropagation();
              pick(null);
            }}
            className="p-0.5 rounded text-slate-500 hover:text-white"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={14} className="text-slate-500" />
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[var(--border)]">
            <input
              autoFocus
              className="input text-sm"
              placeholder="Type a name or reg…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && visible.length) pick(visible[0]);
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => pick(null)}
              className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-[var(--card-hover)]"
            >
              All drivers and vehicles
            </button>
            {[
              ["Drivers", drivers],
              ["Vehicles", cars],
            ].map(([title, list]) =>
              (list as Option[]).length ? (
                <div key={title as string}>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-slate-500">{title as string}</p>
                  {(list as Option[]).map((o) => (
                    <button
                      key={`${o.kind}-${o.id}`}
                      type="button"
                      onClick={() => pick(o)}
                      className={`w-full text-left px-3 py-2 hover:bg-[var(--card-hover)] flex items-center gap-2 ${
                        owner?.id === o.id ? "bg-brand-500/10" : ""
                      }`}
                    >
                      {o.kind === "vehicle" ? (
                        <CarFront size={13} className="text-slate-500 shrink-0" />
                      ) : (
                        <User size={13} className="text-slate-500 shrink-0" />
                      )}
                      <span className="min-w-0">
                        <span className={`block text-xs text-[var(--text)] ${o.kind === "vehicle" ? "font-mono" : ""}`}>
                          {o.label}
                          {o.archived && (
                            <span className="ml-1.5 font-sans text-[10px] text-slate-500">
                              {o.kind === "vehicle" ? "retired" : "left"}
                            </span>
                          )}
                        </span>
                        <span className="block text-[10px] text-slate-500 truncate">{o.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null
            )}
            {!visible.length && <p className="px-3 py-3 text-xs text-slate-500">No match</p>}
          </div>
          <label className="flex items-center gap-2 px-3 py-2 border-t border-[var(--border)] text-[11px] text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-orange-500"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show drivers who left and retired vehicles
          </label>
        </div>
      )}
    </div>
  );
}

const CHECK_STYLE: Record<string, [string, string]> = {
  valid: ["✓", "border-green-500/30 bg-green-500/10 text-green-400"],
  pending: ["⏳", "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"],
  expiring: ["⚠", "border-amber-500/30 bg-amber-500/10 text-amber-400"],
  expired: ["⚠", "border-red-500/30 bg-red-500/10 text-red-400"],
  expiry_needed: ["⚠", "border-orange-500/30 bg-orange-500/10 text-orange-400"],
  rejected: ["✗", "border-red-500/30 bg-red-500/10 text-red-400"],
  missing: ["✗", "border-slate-500/30 bg-slate-500/10 text-slate-400"],
};

/** Every required document for the chosen driver (+ car) or car, from /admin/documents/panel. */
function OwnerChecklist({ owner, onOpen }: { owner: Owner; onOpen: (doc: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["doc-panel", owner.kind === "driver" ? owner.id : null, owner.kind === "vehicle" ? owner.id : null],
    queryFn: () =>
      api
        .get("/admin/documents/panel", { params: owner.kind === "driver" ? { driverId: owner.id } : { vehicleId: owner.id } })
        .then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  if (isLoading || !data)
    return (
      <div className="card p-4 flex justify-center">
        <Spinner size={16} />
      </div>
    );

  const items: any[] = data.items ?? [];
  const state = (i: any) =>
    i.state === "valid" && i.daysLeft !== null && i.daysLeft !== undefined && i.daysLeft <= 30 ? "expiring" : i.state;
  const groups: [string, any[]][] = [
    ["Driver", items.filter((i) => i.owner === "driver")],
    [data.vehicle ? `Car ${data.vehicle.licensePlate}` : "Car", items.filter((i) => i.owner === "vehicle")],
  ];
  const c = data.compliance;

  return (
    <div className="card p-4 space-y-3">
      {c && (
        <p className={`text-xs ${c.eligible ? "text-green-400" : "text-red-400"}`}>
          {c.eligible ? "✓ Can take jobs - all documents approved and in date" : `✗ Can't take jobs: ${c.message || "documents missing"}`}
          {!c.eligible && !c.enforced && <span className="text-slate-500"> (document check not enforced)</span>}
        </p>
      )}
      {owner.kind === "driver" && !data.vehicle && <p className="text-xs text-slate-500">No car assigned.</p>}
      {groups.map(([title, list]) =>
        list.length ? (
          <div key={title} className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 w-full sm:w-28 shrink-0">{title}</span>
            {list.map((i) => {
              const s = state(i);
              const [mark, cls] = CHECK_STYLE[s] ?? ["•", CHECK_STYLE.missing[1]];
              const doc = i.pending ?? i.current ?? i.rejected;
              const detail =
                s === "missing"
                  ? "missing"
                  : s === "pending"
                    ? "waiting for review"
                    : s === "rejected"
                      ? "rejected"
                      : s === "expiry_needed"
                        ? "no expiry date"
                        : i.current?.expiryDate
                          ? format(new Date(i.current.expiryDate), "dd MMM yyyy")
                          : "approved";
              return (
                <button
                  key={i.type}
                  type="button"
                  disabled={!doc}
                  onClick={() => doc && onOpen(doc)}
                  title={doc ? "Open document" : "Not on file - upload it from the Drivers / Vehicles page"}
                  className={`text-[11px] px-2 py-1 rounded-md border ${cls} ${doc ? "hover:brightness-125" : "cursor-default"}`}
                >
                  {mark} {i.label} <span className="opacity-70">· {detail}</span>
                  {s === "valid" && i.pending && <span className="opacity-70"> · new upload waiting</span>}
                </button>
              );
            })}
          </div>
        ) : null
      )}
    </div>
  );
}
