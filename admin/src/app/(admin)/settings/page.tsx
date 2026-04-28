"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { SectionHeader, Spinner } from "@/components/ui";
import {
  PoundSterling,
  Clock,
  Plane,
  AlertTriangle,
  Heart,
  Calculator,
  CheckCircle,
  RefreshCw,
  MapPin,
} from "lucide-react";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PricingConfig {
  baseFare: number;
  perMile: number;
  perMinute: number;
  minimumFare: number;
  platformCommission: number;
  nightPremium: number;
  nightStartHour: number;
  nightEndHour: number;
  bankHolidayPremium: number;
  christmasNyePremium: number;
  meetAndGreet: number;
  dartfordCrossing: number;
  congestionCharge: number;
  extraStopCharge: number;
  freeWaitingMinutes: number;
  waitingRatePerMinute: number;
  retailCancelFreeMinutes: number;
  accountCancelFreeHours: number;
  careHomeUnder3miles: number;
  careHome3to7miles: number;
  careHome7to15miles: number;
  careHome15to25miles: number;
  careHome25to40miles: number;
  careHomeHospitalDischarge: number;
  careHomeHalfDay: number;
  careHomeFullDay: number;
  careHomeHourlyBeyondFull: number;
}

const SECTIONS = [
  "General",
  "Pricing",
  "Dispatch",
  "Notifications",
  "Compliance",
];

const PRICING_TABS = [
  {
    id: "base",
    label: "Base Fare",
    icon: PoundSterling,
    color: "text-brand-400",
  },
  { id: "time", label: "Time Premiums", icon: Clock, color: "text-violet-400" },
  {
    id: "supplements",
    label: "Supplements",
    icon: Plane,
    color: "text-blue-400",
  },
  { id: "carehome", label: "Care Home", icon: Heart, color: "text-pink-400" },
  {
    id: "calculator",
    label: "Calculator",
    icon: Calculator,
    color: "text-green-400",
  },
];

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  step = "0.01",
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  step?: string;
  integer?: boolean;
}) {
  return (
    <div>
      <label
        className="text-xs font-medium block mb-1.5"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        {prefix && (
          <span
            className="text-sm font-medium px-2.5 py-2 rounded-lg border"
            style={{
              background: "var(--table-hover)",
              borderColor: "var(--border)",
              color: "var(--text-muted)",
            }}
          >
            {prefix}
          </span>
        )}
        <input
          type="number"
          step={integer ? "1" : step}
          min="0"
          value={value}
          onChange={(e) =>
            onChange(
              integer
                ? parseInt(e.target.value) || 0
                : parseFloat(e.target.value) || 0
            )
          }
          className="input"
          style={{ maxWidth: 120 }}
        />
        {suffix && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ─── Group header ─────────────────────────────────────────────────────────────
function GroupHeader({
  icon: Icon,
  label,
  color = "text-brand-400",
}: {
  icon: any;
  label: string;
  color?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 mb-4 pb-2 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <Icon size={14} className={color} />
      <h3
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </h3>
    </div>
  );
}

// ─── Address Autocomplete (Google Places JS SDK) ──────────────────────────────
declare global {
  interface Window {
    google: any;
  }
}

function AddressInput({
  label,
  placeholder,
  onSelect,
}: {
  label: string;
  placeholder: string;
  onSelect: (address: string, lat: number, lng: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);

  // Load Google Maps script once
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.google?.maps?.places) {
      setLoaded(true);
      return;
    }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) return;
    if (document.querySelector("script[data-gmaps]")) {
      // Script already injected — wait for it
      const interval = setInterval(() => {
        if (window.google?.maps?.places) {
          setLoaded(true);
          clearInterval(interval);
        }
      }, 100);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    script.async = true;
    script.setAttribute("data-gmaps", "1");
    script.onload = () => setLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Attach Autocomplete once loaded
  useEffect(() => {
    if (!loaded || !inputRef.current) return;
    const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "gb" },
      fields: ["formatted_address", "geometry"],
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (place.geometry?.location) {
        onSelect(
          place.formatted_address ?? "",
          place.geometry.location.lat(),
          place.geometry.location.lng()
        );
      }
    });
  }, [loaded]);

  return (
    <div>
      <label
        className="text-xs mb-1.5 block"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      <div className="relative">
        <MapPin
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className="input pl-8 w-full"
          autoCorrect="off"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

// ─── Live Fare Calculator ─────────────────────────────────────────────────────
function FareCalculator() {
  const [miles, setMiles] = useState(5);
  const [minutes, setMinutes] = useState(15);
  const [meetGreet, setMeetGreet] = useState(false);
  const [congestion, setCongestion] = useState(false);
  const [dartford, setDartford] = useState(false);
  const [extraStops, setExtraStops] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);

  const calculate = useCallback(async () => {
    setLoading(true);
    try {
      const payload: any = {
        distanceMiles: miles,
        durationMinutes: minutes,
        isMeetAndGreet: meetGreet,
        isCongestionCharge: congestion,
        isDartfordCrossing: dartford,
        extraStops,
      };
      if (pickupLat && pickupLng) {
        payload.pickupLatitude = pickupLat;
        payload.pickupLongitude = pickupLng;
      }
      if (dropoffLat && dropoffLng) {
        payload.dropoffLatitude = dropoffLat;
        payload.dropoffLongitude = dropoffLng;
      }
      const { data } = await api.post("/pricing/calculate", payload);
      setResult(data.data);
    } catch {
      toast.error("Calculation failed");
    } finally {
      setLoading(false);
    }
  }, [
    miles,
    minutes,
    meetGreet,
    congestion,
    dartford,
    extraStops,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  ]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  return (
    <div className="space-y-5">
      <GroupHeader
        icon={Calculator}
        label="Live Fare Calculator — test your changes"
        color="text-green-400"
      />

      {/* Surcharge zone address inputs */}
      <div
        className="p-4 rounded-xl border space-y-3"
        style={{
          borderColor: "var(--border)",
          background: "var(--table-hover)",
        }}
      >
        <p className="text-xs font-medium text-green-400 flex items-center gap-1.5">
          <MapPin size={12} /> Surcharge Zone Testing — enter addresses to
          detect airport fees automatically
        </p>
        <div className="grid grid-cols-2 gap-3">
          <AddressInput
            label="Pickup address (optional)"
            placeholder="e.g. Crawley Hospital"
            onSelect={(addr, lat, lng) => {
              setPickupAddress(addr);
              setPickupLat(lat);
              setPickupLng(lng);
            }}
          />
          <AddressInput
            label="Dropoff address (optional)"
            placeholder="e.g. Gatwick South Terminal"
            onSelect={(addr, lat, lng) => {
              setDropoffAddress(addr);
              setDropoffLat(lat);
              setDropoffLng(lng);
            }}
          />
        </div>
        {(pickupLat || dropoffLat) && (
          <p className="text-[11px] text-green-400">
            ✓ Coordinates resolved — surcharge zones will be detected
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="text-xs mb-1.5 block"
                style={{ color: "var(--text-muted)" }}
              >
                Distance (miles)
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={miles}
                onChange={(e) => setMiles(parseFloat(e.target.value) || 1)}
                className="input"
              />
            </div>
            <div>
              <label
                className="text-xs mb-1.5 block"
                style={{ color: "var(--text-muted)" }}
              >
                Duration (mins)
              </label>
              <input
                type="number"
                step="1"
                min="1"
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value) || 1)}
                className="input"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Meet & Greet", state: meetGreet, set: setMeetGreet },
              {
                label: "Congestion Charge",
                state: congestion,
                set: setCongestion,
              },
              { label: "Dartford Crossing", state: dartford, set: setDartford },
            ].map(({ label, state, set }) => (
              <label
                key={label}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={state}
                  onChange={(e) => set(e.target.checked)}
                  className="accent-brand-500"
                />
                <span className="text-xs" style={{ color: "var(--text)" }}>
                  {label}
                </span>
              </label>
            ))}
          </div>
          <div>
            <label
              className="text-xs mb-1.5 block"
              style={{ color: "var(--text-muted)" }}
            >
              Extra stops
            </label>
            <input
              type="number"
              step="1"
              min="0"
              max="5"
              value={extraStops}
              onChange={(e) => setExtraStops(parseInt(e.target.value) || 0)}
              className="input"
              style={{ maxWidth: 80 }}
            />
          </div>
        </div>

        {/* Result */}
        <div>
          {loading && (
            <div className="flex items-center gap-2 py-4">
              <Spinner />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Calculating…
              </span>
            </div>
          )}
          {result && !loading && (
            <div className="space-y-2">
              <div className="text-3xl font-bold text-brand-400">
                £{result.total.toFixed(2)}
              </div>
              <div
                className="text-xs space-y-1 mt-3"
                style={{ color: "var(--text-muted)" }}
              >
                {result.breakdown.map((line: string, i: number) => (
                  <div
                    key={i}
                    className="flex justify-between py-1 border-b"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span>{line.split(":")[0]}</span>
                    <span
                      className="font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {line.split(":")[1]?.trim()}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-2 flex justify-between text-xs">
                <span style={{ color: "var(--text-muted)" }}>Driver earns</span>
                <span className="font-semibold text-green-400">
                  £{result.driverEarning.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: "var(--text-muted)" }}>Platform fee</span>
                <span className="font-semibold text-brand-400">
                  £{result.platformFee.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pricing Section with Tabs ────────────────────────────────────────────────
function PricingSection() {
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("base");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/pricing/config");
      setConfig(data.data);
    } catch {
      toast.error("Failed to load pricing config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (key: keyof PricingConfig, value: number) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.put("/pricing/config", config);
      toast.success("Pricing config saved");
      setDirty(false);
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-12">
        <Spinner size={24} />
      </div>
    );
  if (!config)
    return <div className="text-sm text-red-400">Failed to load config</div>;

  return (
    <div className="space-y-4">
      {/* Header with save */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Pricing Configuration
        </h2>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-brand-400">Unsaved changes</span>
          )}
          <button
            onClick={load}
            className="btn-ghost py-1.5 px-3 flex items-center gap-1.5 text-xs"
          >
            <RefreshCw size={12} /> Reload
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Spinner size={14} /> : <CheckCircle size={14} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex gap-1 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        {PRICING_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all -mb-px whitespace-nowrap ${
                isActive
                  ? `border-brand-500 ${tab.color}`
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div className="card p-5">
        {/* Base Fare */}
        {activeTab === "base" && (
          <>
            <GroupHeader icon={PoundSterling} label="Base Fare Components" />
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Field
                label="Base fare"
                value={config.baseFare}
                onChange={(v) => update("baseFare", v)}
                prefix="£"
                hint="Charged on every booking"
              />
              <Field
                label="Per mile"
                value={config.perMile}
                onChange={(v) => update("perMile", v)}
                prefix="£"
                suffix="/mile"
              />
              <Field
                label="Per minute"
                value={config.perMinute}
                onChange={(v) => update("perMinute", v)}
                prefix="£"
                suffix="/min"
              />
              <Field
                label="Minimum fare"
                value={config.minimumFare}
                onChange={(v) => update("minimumFare", v)}
                prefix="£"
                hint="Floor price regardless of calculation"
              />
              <Field
                label="Platform commission"
                value={Math.round(config.platformCommission * 100)}
                onChange={(v) => update("platformCommission", v / 100)}
                suffix="%"
                hint="Your take — drivers keep the rest"
                step="1"
              />
            </div>
          </>
        )}

        {/* Time Premiums */}
        {activeTab === "time" && (
          <>
            <GroupHeader
              icon={Clock}
              label="Time Premiums"
              color="text-violet-400"
            />
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Field
                label="Night premium"
                value={Math.round(config.nightPremium * 100)}
                onChange={(v) => update("nightPremium", v / 100)}
                suffix="% uplift"
                hint="Applied to subtotal (before supplements)"
                step="1"
              />
              <Field
                label="Night start hour"
                value={config.nightStartHour}
                onChange={(v) => update("nightStartHour", v)}
                suffix="e.g. 23 = 11pm"
                step="1"
                integer
              />
              <Field
                label="Night end hour"
                value={config.nightEndHour}
                onChange={(v) => update("nightEndHour", v)}
                suffix="e.g. 6 = 6am"
                step="1"
                integer
              />
              <Field
                label="Bank holiday premium"
                value={Math.round(config.bankHolidayPremium * 100)}
                onChange={(v) => update("bankHolidayPremium", v / 100)}
                suffix="% uplift"
                step="1"
              />
              <Field
                label="Christmas / NYE premium"
                value={Math.round(config.christmasNyePremium * 100)}
                onChange={(v) => update("christmasNyePremium", v / 100)}
                suffix="% uplift"
                hint="Dec 24–26, Dec 31"
                step="1"
              />
            </div>
          </>
        )}

        {/* Supplements */}
        {activeTab === "supplements" && (
          <div className="space-y-6">
            <div>
              <GroupHeader
                icon={Plane}
                label="Airport Fees (pass-through)"
                color="text-blue-400"
              />
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Field
                  label="Meet & Greet"
                  value={config.meetAndGreet}
                  onChange={(v) => update("meetAndGreet", v)}
                  prefix="£"
                  hint="Name board in arrivals hall"
                />
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Airport pickup/dropoff fees (Gatwick, Heathrow, Luton, City,
                Stansted) are managed via{" "}
                <a
                  href="/surcharge-zones"
                  className="text-brand-400 hover:underline"
                >
                  Surcharge Zones
                </a>{" "}
                using precise polygon boundary detection.
              </p>
            </div>
            <div>
              <GroupHeader
                icon={AlertTriangle}
                label="Other Pass-throughs & Extras"
                color="text-yellow-400"
              />
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Field
                  label="Dartford Crossing"
                  value={config.dartfordCrossing}
                  onChange={(v) => update("dartfordCrossing", v)}
                  prefix="£"
                />
                <Field
                  label="London Congestion Charge"
                  value={config.congestionCharge}
                  onChange={(v) => update("congestionCharge", v)}
                  prefix="£"
                  hint="ULEZ is £0 — Tesla is EV"
                />
                <Field
                  label="Extra stop charge"
                  value={config.extraStopCharge}
                  onChange={(v) => update("extraStopCharge", v)}
                  prefix="£"
                  suffix="/stop"
                />
                <Field
                  label="Free waiting time"
                  value={config.freeWaitingMinutes}
                  onChange={(v) => update("freeWaitingMinutes", v)}
                  suffix="minutes free"
                  step="1"
                  integer
                />
                <Field
                  label="Waiting rate (after free)"
                  value={config.waitingRatePerMinute}
                  onChange={(v) => update("waitingRatePerMinute", v)}
                  prefix="£"
                  suffix="/min"
                />
              </div>
            </div>
            <div>
              <GroupHeader
                icon={AlertTriangle}
                label="Cancellation Policy"
                color="text-red-400"
              />
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Field
                  label="Retail: free cancel window"
                  value={config.retailCancelFreeMinutes}
                  onChange={(v) => update("retailCancelFreeMinutes", v)}
                  suffix="mins after booking"
                  step="1"
                  integer
                  hint="Free cancellation within this window"
                />
                <Field
                  label="Account: free cancel window"
                  value={config.accountCancelFreeHours}
                  onChange={(v) => update("accountCancelFreeHours", v)}
                  suffix="hrs before pickup"
                  step="1"
                  integer
                  hint="Free cancellation up to this far in advance"
                />
              </div>
            </div>
          </div>
        )}

        {/* Care Home */}
        {activeTab === "carehome" && (
          <>
            <GroupHeader
              icon={Heart}
              label="Care Home Distance Bands"
              color="text-pink-400"
            />
            <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
              Flat-rate pricing by distance — no time component. Used for care
              home contract bookings.
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Field
                label="Under 3 miles"
                value={config.careHomeUnder3miles}
                onChange={(v) => update("careHomeUnder3miles", v)}
                prefix="£"
                hint="GP, pharmacy, local shops"
              />
              <Field
                label="3 – 7 miles"
                value={config.careHome3to7miles}
                onChange={(v) => update("careHome3to7miles", v)}
                prefix="£"
                hint="Hospital appointments, day centres"
              />
              <Field
                label="7 – 15 miles"
                value={config.careHome7to15miles}
                onChange={(v) => update("careHome7to15miles", v)}
                prefix="£"
                hint="Specialist clinics, outpatient"
              />
              <Field
                label="15 – 25 miles"
                value={config.careHome15to25miles}
                onChange={(v) => update("careHome15to25miles", v)}
                prefix="£"
                hint="Cross-county appointments"
              />
              <Field
                label="25 – 40 miles"
                value={config.careHome25to40miles}
                onChange={(v) => update("careHome25to40miles", v)}
                prefix="£"
                hint="Gatwick transfers, family visits"
              />
              <Field
                label="Hospital discharge supplement"
                value={config.careHomeHospitalDischarge}
                onChange={(v) => update("careHomeHospitalDischarge", v)}
                prefix="£"
                hint="Extra wait + equipment loading"
              />
              <Field
                label="Half-day rate (up to 4 hrs)"
                value={config.careHomeHalfDay}
                onChange={(v) => update("careHomeHalfDay", v)}
                prefix="£"
                hint="Funerals, family events, multi-stop"
              />
              <Field
                label="Full-day rate (up to 8 hrs)"
                value={config.careHomeFullDay}
                onChange={(v) => update("careHomeFullDay", v)}
                prefix="£"
                hint="Weddings, multi-appointment days"
              />
              <Field
                label="Hourly beyond full day"
                value={config.careHomeHourlyBeyondFull}
                onChange={(v) => update("careHomeHourlyBeyondFull", v)}
                prefix="£"
                suffix="/hr"
                hint="After 8 hours"
              />
            </div>
          </>
        )}

        {/* Calculator */}
        {activeTab === "calculator" && <FareCalculator />}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [active, setActive] = useState("General");
  const [saved, setSaved] = useState(false);

  const save = () => {
    toast.success("Settings saved");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Settings"
        subtitle="System configuration and preferences"
      />
      <div className="flex gap-5">
        {/* Side nav */}
        <div className="w-44 shrink-0 space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                active === s
                  ? "bg-brand-500/10 text-brand-400"
                  : "text-slate-400 hover:text-white hover:bg-[var(--table-hover)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {active === "Pricing" ? (
            <PricingSection />
          ) : (
            <div className="card p-6 space-y-6">
              {active === "General" && (
                <>
                  <h2
                    className="text-sm font-semibold border-b pb-3"
                    style={{
                      color: "var(--text)",
                      borderColor: "var(--border)",
                    }}
                  >
                    General Settings
                  </h2>
                  <div className="space-y-4">
                    {[
                      {
                        label: "Company Name",
                        value: "OrangeRide",
                        key: "companyName",
                      },
                      {
                        label: "TfL Operator Licence Number",
                        value: "II786",
                        key: "licenseNumber",
                      },
                      {
                        label: "Contact Email",
                        value: "admin@orangeride.co.uk",
                        key: "email",
                      },
                      {
                        label: "Contact Phone",
                        value: "+44 7476 999805",
                        key: "phone",
                      },
                      {
                        label: "Business Address",
                        value: "Regus, One Elmfield Park, Bromley, BR1 1LU",
                        key: "address",
                      },
                    ].map(({ label, value, key }) => (
                      <div key={key}>
                        <label
                          className="text-xs block mb-1.5"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {label}
                        </label>
                        <input
                          defaultValue={value}
                          className="input max-w-md"
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
              {active === "Dispatch" && (
                <>
                  <h2
                    className="text-sm font-semibold border-b pb-3"
                    style={{
                      color: "var(--text)",
                      borderColor: "var(--border)",
                    }}
                  >
                    Dispatch Engine
                  </h2>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 max-w-lg">
                      {[
                        {
                          label: "Driver Accept Timeout (seconds)",
                          value: "60",
                          key: "acceptTimeout",
                        },
                        {
                          label: "Max Dispatch Attempts",
                          value: "3",
                          key: "maxAttempts",
                        },
                        {
                          label: "Max Search Radius (km)",
                          value: "10",
                          key: "searchRadius",
                        },
                        {
                          label: "Pre-book Lead Time (minutes)",
                          value: "30",
                          key: "leadTime",
                        },
                      ].map(({ label, value, key }) => (
                        <div key={key}>
                          <label
                            className="text-xs block mb-1.5"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {label}
                          </label>
                          <input
                            defaultValue={value}
                            type="number"
                            className="input"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-3 pt-2">
                      {[
                        {
                          label: "Auto-dispatch ASAP jobs",
                          description:
                            "Automatically offer ASAP jobs to nearest available driver",
                          defaultChecked: true,
                        },
                        {
                          label: "Escalate to manual after max attempts",
                          description:
                            "Alert dispatcher if no driver accepts within configured attempts",
                          defaultChecked: true,
                        },
                        {
                          label: "Allow driver to reject jobs",
                          description:
                            "Drivers can decline job offers (recommended)",
                          defaultChecked: true,
                        },
                      ].map(({ label, description, defaultChecked }) => (
                        <label
                          key={label}
                          className="flex items-start gap-3 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            defaultChecked={defaultChecked}
                            className="mt-0.5 accent-brand-500"
                          />
                          <div>
                            <p
                              className="text-xs group-hover:text-brand-400 transition-colors"
                              style={{ color: "var(--text)" }}
                            >
                              {label}
                            </p>
                            <p
                              className="text-[11px] mt-0.5"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {description}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {active === "Notifications" && (
                <>
                  <h2
                    className="text-sm font-semibold border-b pb-3"
                    style={{
                      color: "var(--text)",
                      borderColor: "var(--border)",
                    }}
                  >
                    Notification Settings
                  </h2>
                  <div className="space-y-3">
                    {[
                      {
                        label: "New booking created",
                        channels: ["Push", "Email"],
                      },
                      { label: "Driver assigned", channels: ["Push", "SMS"] },
                      { label: "Driver arrived", channels: ["Push", "SMS"] },
                      { label: "Trip completed", channels: ["Push", "Email"] },
                      {
                        label: "Booking cancelled",
                        channels: ["Push", "Email"],
                      },
                      { label: "Document expiry alert", channels: ["Email"] },
                      {
                        label: "Manual dispatch required",
                        channels: ["Push", "Email"],
                      },
                    ].map(({ label, channels }) => (
                      <div
                        key={label}
                        className="flex items-center justify-between py-2 border-b"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <p
                          className="text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {label}
                        </p>
                        <div className="flex gap-2">
                          {["Push", "SMS", "Email"].map((c) => (
                            <label
                              key={c}
                              className="flex items-center gap-1.5 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                defaultChecked={channels.includes(c)}
                                className="accent-brand-500"
                              />
                              <span
                                className="text-[11px]"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {c}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {active === "Compliance" && (
                <>
                  <h2
                    className="text-sm font-semibold border-b pb-3"
                    style={{
                      color: "var(--text)",
                      borderColor: "var(--border)",
                    }}
                  >
                    TfL Compliance Settings
                  </h2>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                      These settings appear on all passenger receipts and are
                      legally required under TfL Operator Licence II786.
                    </div>
                    {[
                      { label: "Operator Licence Number", value: "II786" },
                      {
                        label: "Operator Name (as licensed)",
                        value: "ORANGERIDE",
                      },
                      {
                        label: "Registered Address",
                        value: "Regus, One Elmfield Park, Bromley, BR1 1LU",
                      },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <label
                          className="text-xs block mb-1.5"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {label}
                        </label>
                        <input
                          defaultValue={value}
                          className="input max-w-md"
                        />
                      </div>
                    ))}
                    <div className="space-y-3 pt-2">
                      {[
                        {
                          label:
                            "Alert when PCO licence expires within 60 days",
                          defaultChecked: true,
                        },
                        {
                          label:
                            "Alert when vehicle MOT expires within 30 days",
                          defaultChecked: true,
                        },
                        {
                          label:
                            "Alert when vehicle insurance expires within 30 days",
                          defaultChecked: true,
                        },
                        {
                          label:
                            "Block driver from receiving jobs if documents expired",
                          defaultChecked: true,
                        },
                        {
                          label:
                            "Include driver PCO badge on passenger receipts",
                          defaultChecked: true,
                        },
                      ].map(({ label, defaultChecked }) => (
                        <label
                          key={label}
                          className="flex items-center gap-3 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            defaultChecked={defaultChecked}
                            className="accent-brand-500"
                          />
                          <span
                            className="text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {active !== "Pricing" && (
                <div
                  className="pt-4 border-t"
                  style={{ borderColor: "var(--border)" }}
                >
                  <button onClick={save} className="btn-primary">
                    {saved ? "✓ Saved" : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
