"use client";
// Araa, the AI phone receptionist: every call she answered, and her settings.
// Calls: outcome, caller, trip and fare, booking link (NEEDS APPROVAL), transcript on click.
// Settings: on 24/7 / set hours / off, voice, greeting, notice, who gets the texts.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { PhoneCall, Settings2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { Modal, SectionHeader, Spinner, Table } from "@/components/ui";

const OUTCOMES: Record<string, [string, string]> = {
  BOOKED: ["Booking request", "bg-green-500/15 text-green-400"],
  TOO_SOON: ["Too soon", "bg-amber-500/15 text-amber-400"],
  OUT_OF_AREA: ["Out of area", "bg-amber-500/15 text-amber-400"],
  MESSAGE: ["Message", "bg-blue-500/15 text-blue-400"],
  COMPLAINT: ["Complaint", "bg-red-500/15 text-red-400"],
  LOST_PROPERTY: ["Lost property", "bg-violet-500/15 text-violet-400"],
  COMPLIMENT: ["Compliment", "bg-green-500/15 text-green-400"],
  NO_BOOKING: ["No booking", "bg-slate-500/15 text-slate-400"],
  REJECTED: ["Not answered", "bg-slate-500/15 text-slate-400"],
  FAILED: ["Dropped", "bg-red-500/15 text-red-400"],
  IN_PROGRESS: ["On a call", "bg-brand-500/15 text-brand-400"],
};

const FILTERS = [
  { key: "", label: "All calls" },
  { key: "AWAITING", label: "Waiting for approval" },
  { key: "BOOKED", label: "Booking requests" },
  { key: "MESSAGE", label: "Messages" },
  { key: "REPORTS", label: "Complaints & lost property" },
  { key: "TOO_SOON", label: "Too soon" },
] as const;

function Outcome({ outcome }: { outcome: string }) {
  const [label, cls] = OUTCOMES[outcome] ?? [outcome, "bg-slate-500/15 text-slate-400"];
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{label}</span>;
}

const mins = (s?: number | null) => (s == null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

export default function AraaPage() {
  const [tab, setTab] = useState<"calls" | "settings">("calls");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "settings") setTab("settings");
  }, []);
  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Araa"
        subtitle="The AI phone receptionist: calls she answered, booking requests waiting for you, and her settings."
      />
      <div className="flex gap-1 p-1 bg-[var(--table-hover)] rounded-lg border border-[var(--border)] w-fit">
        {[
          { key: "calls" as const, label: "Calls", Icon: PhoneCall },
          { key: "settings" as const, label: "Settings", Icon: Settings2 },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1.5 ${
              tab === key ? "bg-brand-500 text-black" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {tab === "calls" ? <Calls /> : <SettingsForm />}
    </div>
  );
}

function Calls() {
  const [filter, setFilter] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["voice-calls", filter],
    queryFn: () => api.get("/admin/voice-calls", { params: { limit: 100, ...(filter && { outcome: filter }) } }).then((r) => r.data.data),
    refetchInterval: 20_000,
  });
  const items: any[] = data?.items ?? [];
  const awaiting: number = data?.awaitingApproval ?? 0;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
              filter === f.key ? "border-brand-500 text-brand-400 bg-brand-500/10" : "border-[var(--border)] text-slate-400 hover:text-white"
            }`}
          >
            {f.label}
            {f.key === "AWAITING" && awaiting > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black">{awaiting}</span>
            )}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={["When", "Caller", "Outcome", "Trip", "Booking", "Length"]}
            isEmpty={!items.length}
            emptyMessage={filter ? "No calls like that yet" : "No calls yet. Ring +44 7476 999805 to try Araa."}
          >
            {items.map((c) => {
              const q = c.quote ?? null;
              return (
                <tr key={c.id} className="table-row cursor-pointer" onClick={() => setOpenId(c.id)}>
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{format(new Date(c.startedAt), "dd MMM HH:mm")}</td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-[var(--text)]">
                      {c.callerName ?? "—"}
                      {c.passenger?.isTestAccount && (
                        <span className="ml-1.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-slate-500/15 text-slate-400">TEST</span>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-500">{c.fromNumber ?? "Withheld"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Outcome outcome={c.outcome} />
                    {c.message && <p className="text-[10px] text-slate-500 mt-1 max-w-[220px] truncate">{c.message}</p>}
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    {q ? (
                      <>
                        <p className="text-xs text-slate-400 truncate">
                          {q.pickup} → {q.dropoff}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {q.when ? format(new Date(q.when), "EEE dd MMM HH:mm") : ""}
                          {q.fare != null ? ` · £${Number(q.fare).toFixed(2)}` : q.outOfArea ? " · outside our area" : ""}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {c.booking ? (
                      <a href={`/bookings?open=${c.booking.id}`} className="font-mono text-xs text-brand-400 hover:underline">
                        {c.booking.reference}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                    {c.booking?.isOnHold && c.booking.status === "CONFIRMED" && (
                      <span className="ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        NEEDS APPROVAL
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{mins(c.durationSeconds)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>
      <CallModal id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function CallModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: c, isLoading } = useQuery({
    queryKey: ["voice-call", id],
    queryFn: () => api.get(`/admin/voice-calls/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });
  const lines: any[] = Array.isArray(c?.transcript) ? c.transcript : [];
  return (
    <Modal open={!!id} onClose={onClose} title="Call with Araa">
      {isLoading || !c ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Outcome outcome={c.outcome} />
            <span>{format(new Date(c.startedAt), "EEE dd MMM yyyy, HH:mm")}</span>
            <span>· {mins(c.durationSeconds)}</span>
            <span>· {c.callerName ?? "Unknown"} ({c.fromNumber ?? "withheld"})</span>
            {c.booking && (
              <a href={`/bookings?open=${c.booking.id}`} className="font-mono text-brand-400 hover:underline">
                · {c.booking.reference}
              </a>
            )}
          </div>
          {c.message && (
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-[var(--text)]">
              <span className="font-semibold">Message:</span> {c.message}
            </div>
          )}
          {["COMPLAINT", "LOST_PROPERTY", "COMPLIMENT"].includes(c.outcome) && (
            <a href="/alerts" className="inline-block text-xs text-brand-400 hover:underline">
              Open in Alerts (complaints and lost property registers) →
            </a>
          )}
          {c.error && <p className="text-xs text-red-400">Problem: {c.error}</p>}
          <div className="max-h-[50vh] overflow-y-auto space-y-2 text-xs">
            {lines.length === 0 && <p className="text-slate-500">No transcript.</p>}
            {lines
              .filter((l) => l.who !== "tool")
              .map((l, i) => (
                <div key={i} className={`flex ${l.who === "araa" ? "" : "justify-end"}`}>
                  <p
                    className={`max-w-[80%] px-3 py-2 rounded-lg ${
                      l.who === "araa" ? "bg-[var(--card-hover)] text-slate-300" : "bg-brand-500/15 text-[var(--text)]"
                    }`}
                  >
                    <span className="block text-[10px] text-slate-500 mb-0.5">
                      {l.who === "araa" ? "Araa" : "Caller"} · {format(new Date(l.at), "HH:mm:ss")}
                    </span>
                    {l.text}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// Example only: Kapil checks and edits every line before saving.
const FAQ_EXAMPLE = `OrangeRide is a TfL-licensed private hire operator (licence 11786), based in Crawley.
We mainly cover Gatwick Airport, Crawley, Horley and the surrounding area; longer trips on request.
Cars: [please edit, e.g. Tesla Model Y and similar]. Up to 4 passengers and their luggage.
Bookings need at least 24 hours' notice.
Gatwick pickups: we meet you at the terminal car park meeting point and track your flight.
Payment: cash or card to the driver on the day (card reader in the car).
Child seats: [yes / no / on request — please edit]
Pets: [please edit]
Wheelchairs: [please edit]`;

const MODES = [
  { key: "ALWAYS", label: "On, 24/7", help: "Araa answers every call she gets and takes booking requests." },
  { key: "HOURS", label: "Set hours", help: "Booking requests during these hours; outside them she takes a message." },
  { key: "OFF", label: "Off", help: "Calls aren't answered by Araa. Turn the EE divert off too." },
] as const;

function SettingsForm() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["voice-agent-settings"],
    queryFn: () => api.get("/admin/voice-agent/settings").then((r) => r.data.data),
  });
  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    if (data?.settings && !form) setForm({ ...data.settings, minNoticeHours: String(data.settings.minNoticeHours) });
  }, [data, form]);
  const save = useMutation({
    mutationFn: () => api.put("/admin/voice-agent/settings", { ...form, minNoticeHours: Number(form.minNoticeHours) }),
    onSuccess: (r) => {
      toast.success("Saved. Applies from the next call.");
      const s = r.data.data.settings;
      setForm({ ...s, minNoticeHours: String(s.minNoticeHours) });
      qc.invalidateQueries({ queryKey: ["voice-agent-settings"] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error ?? "Couldn't save"),
  });

  if (isLoading || !form)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    );
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }));
  const label = "block text-xs font-medium text-[var(--text)] mb-1.5";
  const help = "text-[10px] text-slate-500 mt-1";

  return (
    <div className="card p-5 space-y-5 max-w-2xl">
      {!data.configured && (
        <p className="text-xs text-red-400 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          OpenAI isn't connected on the server (OPENAI_API_KEY / OPENAI_WEBHOOK_SECRET), so calls can't be answered.
        </p>
      )}

      <div>
        <p className={label}>When Araa answers</p>
        <div className="grid sm:grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setForm((f: any) => ({ ...f, mode: m.key }))}
              className={`text-left p-3 rounded-lg border transition-all ${
                form.mode === m.key ? "border-brand-500 bg-brand-500/10" : "border-[var(--border)] hover:border-slate-500"
              }`}
            >
              <span className="block text-xs font-semibold text-[var(--text)]">{m.label}</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">{m.help}</span>
            </button>
          ))}
        </div>
      </div>

      {form.mode === "HOURS" && (
        <div>
          <label className={label}>Booking hours (UK time)</label>
          <input className="input w-48" value={form.hours} onChange={set("hours")} placeholder="06:00-23:00" />
          <p className={help}>e.g. 06:00-23:00. A window past midnight works too, e.g. 18:00-02:00.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Voice</label>
          <select className="input" value={form.voice} onChange={set("voice")}>
            {(data.voices as string[]).map((v) => (
              <option key={v} value={v}>
                {v}
                {v === "marin" ? " (default)" : ""}
              </option>
            ))}
          </select>
          <p className={help}>Softer options: shimmer, coral, sage.</p>
        </div>
        <div>
          <label className={label}>Minimum notice (hours)</label>
          <input className="input w-32" type="number" min={0} max={168} value={form.minNoticeHours} onChange={set("minNoticeHours")} />
          <p className={help}>Trips sooner than this become a message for you to call back.</p>
        </div>
      </div>

      <div>
        <label className={label}>Greeting for new callers</label>
        <textarea className="input min-h-[70px]" maxLength={300} value={form.greeting} onChange={set("greeting")} />
        <p className={help}>Returning passengers are greeted by name instead. Keep "virtual assistant" in it so callers know.</p>
      </div>

      <div>
        <label className={label}>Facts Araa can use to answer questions</label>
        <textarea
          className="input min-h-[180px] font-mono text-xs"
          maxLength={3000}
          value={form.faq ?? ""}
          onChange={set("faq")}
          placeholder={FAQ_EXAMPLE}
        />
        <p className={help}>
          One fact per line. Araa answers questions only from these; anything else becomes a message for you. Leave empty and
          she takes a message for every question. ({(form.faq ?? "").length}/3000)
        </p>
        {!form.faq && (
          <button type="button" className="text-[11px] text-brand-400 hover:underline mt-1" onClick={() => setForm((f: any) => ({ ...f, faq: FAQ_EXAMPLE }))}>
            Start from the example (then check every line)
          </button>
        )}
      </div>

      <div>
        <label className={label}>Texts about calls go to</label>
        <input className="input w-56" value={form.alertPhone} onChange={set("alertPhone")} />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <span className="text-[10px] text-slate-500">Changes apply from the next call.</span>
      </div>
    </div>
  );
}
