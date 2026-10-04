"use client";
// admin/src/app/(admin)/airport-pickups/page.tsx
//
// Airport pickups configuration:
//   - pickup buffers (minutes after landing) for hand luggage / checked bags
//   - meeting point per terminal: name, passenger instructions, exact map pin
// Each pin is checked live against the airport's surcharge zone, so a meeting
// point can't silently fall outside the area that gets the airport charge.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState, useEffect, useCallback } from "react";
import { SectionHeader, Table, Modal, Spinner } from "@/components/ui";
import {
  MapPin,
  Pencil,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  PlaneLanding,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  GoogleMap,
  Marker,
  Polygon,
  Circle as MapCircle,
  useLoadScript,
} from "@react-google-maps/api";

// ── Types ────────────────────────────────────────────────────────────────────
type LatLng = { lat: number; lng: number };
type Zone = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  polygon: LatLng[] | null;
};
type MeetingPoint = {
  id: string;
  airportIata: string;
  terminal: string;
  name: string;
  instructions: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  insideZone: boolean;
  zone: { id: string; name: string } | null;
  upcomingBookings: number;
};
type PickupData = {
  buffers: { hand: number; checked: number };
  bufferLimits: { min: number; max: number };
  meetingPoints: MeetingPoint[];
  zones: Record<string, Zone | null>;
};

const MAP_LIBRARIES: ("drawing" | "places")[] = [];
const TERMINAL_LABEL: Record<string, string> = {
  NORTH: "North Terminal",
  SOUTH: "South Terminal",
};

// Same rule as the backend (polygon first, else radius) for live feedback while dragging.
function pointInPolygon(lat: number, lng: number, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.lat > lat !== b.lat > lat &&
      lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng
    )
      inside = !inside;
  }
  return inside;
}
function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) *
      Math.cos(r(b.lat)) *
      Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function insideZone(pt: LatLng, zone: Zone | null): boolean {
  if (!zone) return false;
  if (Array.isArray(zone.polygon) && zone.polygon.length >= 3)
    return pointInPolygon(pt.lat, pt.lng, zone.polygon);
  return (
    metersBetween(pt, { lat: zone.latitude, lng: zone.longitude }) <=
    zone.radiusMeters
  );
}

// ── Zone status badge ────────────────────────────────────────────────────────
function ZoneBadge({
  inside,
  zoneName,
}: {
  inside: boolean;
  zoneName?: string | null;
}) {
  if (!zoneName) {
    return (
      <span className="badge text-[10px] bg-red-500/20 text-red-400 inline-flex items-center gap-1">
        <AlertTriangle size={10} /> No airport zone
      </span>
    );
  }
  return inside ? (
    <span className="badge text-[10px] bg-green-500/20 text-green-400 inline-flex items-center gap-1">
      <CheckCircle2 size={10} /> Inside {zoneName}
    </span>
  ) : (
    <span className="badge text-[10px] bg-amber-500/20 text-amber-400 inline-flex items-center gap-1">
      <AlertTriangle size={10} /> Outside {zoneName}
    </span>
  );
}

// ── Pin editor (satellite map, single draggable pin, zone overlay) ───────────
function PinEditor({
  point,
  zone,
  onChange,
}: {
  point: LatLng;
  zone: Zone | null;
  onChange: (p: LatLng) => void;
}) {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!,
    libraries: MAP_LIBRARIES,
  });
  const [center] = useState<LatLng>(point); // don't recentre on every drag

  const handleMove = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    },
    [onChange]
  );

  if (!isLoaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={20} />
      </div>
    );
  }

  const zoneStyle = {
    fillColor: "#f97316",
    fillOpacity: 0.12,
    strokeColor: "#f97316",
    strokeOpacity: 0.8,
    strokeWeight: 2,
    clickable: false,
  };
  const hasPolygon =
    !!zone && Array.isArray(zone.polygon) && zone.polygon.length >= 3;

  return (
    <div className="space-y-2">
      <div
        className="rounded-xl overflow-hidden border"
        style={{ borderColor: "var(--border)" }}
      >
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "360px" }}
          center={center}
          zoom={17}
          onClick={handleMove}
          options={{
            mapTypeId: "satellite",
            streetViewControl: false,
            mapTypeControl: true,
            fullscreenControl: true,
            clickableIcons: false,
          }}
        >
          {zone && hasPolygon && (
            <Polygon paths={zone.polygon as LatLng[]} options={zoneStyle} />
          )}
          {zone && !hasPolygon && (
            <MapCircle
              center={{ lat: zone.latitude, lng: zone.longitude }}
              radius={zone.radiusMeters}
              options={zoneStyle}
            />
          )}
          <Marker
            position={point}
            draggable
            onDragEnd={handleMove}
            title="Drag to the exact meeting point"
          />
        </GoogleMap>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Drag the pin, or click the map, to set the exact spot. Orange area =
          airport surcharge zone.
        </p>
        <ZoneBadge inside={insideZone(point, zone)} zoneName={zone?.name} />
      </div>
      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
      </p>
    </div>
  );
}

// ── Buffers card ─────────────────────────────────────────────────────────────
function BuffersCard({
  buffers,
  limits,
}: {
  buffers: { hand: number; checked: number };
  limits: { min: number; max: number };
}) {
  const qc = useQueryClient();
  const [hand, setHand] = useState(String(buffers.hand));
  const [checked, setChecked] = useState(String(buffers.checked));

  useEffect(() => {
    setHand(String(buffers.hand));
    setChecked(String(buffers.checked));
  }, [buffers.hand, buffers.checked]);

  const save = useMutation({
    mutationFn: () =>
      api.put("/admin/airport-pickups/buffers", {
        hand: Number(hand),
        checked: Number(checked),
      }),
    onSuccess: () => {
      toast.success("Pickup buffers saved");
      qc.invalidateQueries({ queryKey: ["airport-pickups"] });
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to save buffers"),
  });

  const dirty =
    hand !== String(buffers.hand) || checked !== String(buffers.checked);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-brand-400" />
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Pickup time after landing
        </p>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Pickup is set to the flight's scheduled landing plus this buffer.
        Passengers can choose a later time, never an earlier one.
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Hand luggage only (min)
          </label>
          <input
            type="number"
            min={limits.min}
            max={limits.max}
            step={5}
            value={hand}
            onChange={(e) => setHand(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Checked bags (min)
          </label>
          <input
            type="number"
            min={limits.min}
            max={limits.max}
            step={5}
            value={checked}
            onChange={(e) => setChecked(e.target.value)}
            className="input"
          />
        </div>
      </div>
      <button
        onClick={() => save.mutate()}
        disabled={!dirty || save.isPending}
        className="btn-primary flex items-center gap-2 text-sm"
      >
        {save.isPending ? <Spinner size={14} /> : null} Save buffers
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AirportPickupsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MeetingPoint | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pin, setPin] = useState<LatLng>({ lat: 0, lng: 0 });
  const [isActive, setIsActive] = useState(false);

  const { data, isLoading } = useQuery<PickupData>({
    queryKey: ["airport-pickups"],
    queryFn: () => api.get("/admin/airport-pickups").then((r) => r.data.data),
  });

  const afterSave = (res: any, successMsg: string) => {
    toast.success(successMsg);
    if (res?.data?.warning)
      toast(res.data.warning, { icon: "⚠️", duration: 8000 });
    qc.invalidateQueries({ queryKey: ["airport-pickups"] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: { id: string; body: Record<string, unknown> }) =>
      api.put(
        `/admin/airport-pickups/meeting-points/${payload.id}`,
        payload.body
      ),
    onSuccess: (res) => {
      afterSave(res, "Meeting point saved");
      setEditing(null);
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to save meeting point"),
  });

  const toggleMutation = useMutation({
    mutationFn: (p: { id: string; isActive: boolean }) =>
      api.put(`/admin/airport-pickups/meeting-points/${p.id}`, {
        isActive: p.isActive,
      }),
    onSuccess: (res, p) =>
      afterSave(
        res,
        p.isActive ? "Meeting point activated" : "Meeting point deactivated"
      ),
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to update status"),
  });

  const openEdit = (mp: MeetingPoint) => {
    setEditing(mp);
    setName(mp.name);
    setInstructions(mp.instructions);
    setPin({ lat: mp.latitude, lng: mp.longitude });
    setIsActive(mp.isActive);
  };

  const onSave = () => {
    if (!editing) return;
    if (!name.trim() || !instructions.trim()) {
      toast.error("Name and instructions are required");
      return;
    }
    saveMutation.mutate({
      id: editing.id,
      body: {
        name,
        instructions,
        latitude: pin.lat,
        longitude: pin.lng,
        isActive,
      },
    });
  };

  const points = data?.meetingPoints ?? [];
  const editingZone = editing
    ? data?.zones?.[editing.airportIata] ?? null
    : null;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Airport Pickups"
        subtitle="Meeting points and pickup timing for passengers arriving by air"
      />

      {isLoading || !data ? (
        <div className="card flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : (
        <>
          <BuffersCard buffers={data.buffers} limits={data.bufferLimits} />

          <div className="card overflow-hidden">
            <Table
              headers={[
                "Terminal",
                "Meeting point",
                "Pin",
                "Upcoming",
                "Status",
                "",
              ]}
              isEmpty={!points.length}
              emptyMessage="No meeting points configured"
            >
              {points.map((mp) => (
                <tr key={mp.id} className="table-row">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0">
                        <PlaneLanding size={13} className="text-brand-400" />
                      </div>
                      <div>
                        <p
                          className="text-xs font-medium"
                          style={{ color: "var(--text)" }}
                        >
                          {TERMINAL_LABEL[mp.terminal] ?? mp.terminal}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {mp.airportIata}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      className="text-xs font-medium"
                      style={{ color: "var(--text)" }}
                    >
                      {mp.name}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[280px]">
                      {mp.instructions}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <ZoneBadge
                        inside={mp.insideZone}
                        zoneName={mp.zone?.name}
                      />
                      <p className="text-[10px] text-slate-600 flex items-center gap-1">
                        <MapPin size={10} /> {mp.latitude.toFixed(5)},{" "}
                        {mp.longitude.toFixed(5)}
                      </p>
                    </div>
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {mp.upcomingBookings}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        toggleMutation.mutate({
                          id: mp.id,
                          isActive: !mp.isActive,
                        })
                      }
                      className="flex items-center gap-1.5 text-xs transition-colors"
                      style={{
                        color: mp.isActive ? "var(--text-muted)" : "#64748b",
                      }}
                    >
                      {mp.isActive ? (
                        <ToggleRight size={18} className="text-green-400" />
                      ) : (
                        <ToggleLeft size={18} className="text-slate-500" />
                      )}
                      <span>{mp.isActive ? "Active" : "Inactive"}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(mp)}
                      className="text-slate-500 hover:text-brand-400 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>

          <div
            className="card p-4 text-xs space-y-1"
            style={{ color: "var(--text-muted)" }}
          >
            <p className="font-semibold" style={{ color: "var(--text)" }}>
              How meeting points are used
            </p>
            <p>
              When a passenger books a pickup from the airport, the pickup
              address and map pin become the meeting point for their terminal,
              and the instructions are shown in their app.
            </p>
            <p>
              Inactive meeting points are never offered. Set the exact pin
              before activating.
            </p>
          </div>
        </>
      )}

      {/* ── Edit modal ── */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing
            ? `Edit — ${TERMINAL_LABEL[editing.terminal] ?? editing.terminal}`
            : ""
        }
        size="xl"
      >
        {editing && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Meeting point name *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="input"
                placeholder="e.g. Car Park 6, Level 4"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Instructions for passengers *
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={500}
                rows={3}
                className="input"
                placeholder="How to get from arrivals to the meeting point"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                {instructions.length}/500
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Exact location
              </label>
              <PinEditor point={pin} zone={editingZone} onChange={setPin} />
            </div>
            <label
              className="flex items-center gap-2 text-xs cursor-pointer"
              style={{ color: "var(--text)" }}
            >
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active (offered to passengers)
            </label>
            {editing.upcomingBookings > 0 && (
              <p className="text-[10px] text-amber-400">
                {editing.upcomingBookings} upcoming booking(s) use this meeting
                point. Changing the pin won't move them.
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saveMutation.isPending}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                {saveMutation.isPending ? <Spinner size={14} /> : null} Save
                Changes
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
