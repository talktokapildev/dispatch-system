"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState, useCallback, useRef } from "react";
import {
  SectionHeader,
  Table,
  Modal,
  Spinner,
  EmptyState,
} from "@/components/ui";
import {
  Plus,
  MapPin,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Hexagon,
  Circle,
  Undo2,
  Eraser,
  Code2,
  CheckCircle2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import {
  GoogleMap,
  Polygon,
  Marker,
  useLoadScript,
} from "@react-google-maps/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface LatLng {
  lat: number;
  lng: number;
}

const ZONE_TYPES = ["AIRPORT", "HOTEL", "VENUE", "OTHER"];
const TYPE_COLOURS: Record<string, string> = {
  AIRPORT: "bg-blue-500/20 text-blue-400",
  HOTEL: "bg-violet-500/20 text-violet-400",
  VENUE: "bg-green-500/20 text-green-400",
  OTHER: "bg-slate-500/20 text-slate-400",
};

const MAP_LIBRARIES: ("drawing" | "places")[] = [];

// ── Polygon Map Editor Component ─────────────────────────────────────────────

function PolygonMapEditor({
  points,
  onChange,
  center,
}: {
  points: LatLng[];
  onChange: (pts: LatLng[]) => void;
  center: LatLng;
}) {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY!,
    libraries: MAP_LIBRARIES,
  });

  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const mapRef = useRef<google.maps.Map | null>(null);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      onChange([...points, { lat: e.latLng.lat(), lng: e.latLng.lng() }]);
    },
    [points, onChange]
  );

  const handleMarkerDrag = useCallback(
    (index: number, e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const updated = [...points];
      updated[index] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      onChange(updated);
    },
    [points, onChange]
  );

  const handleMarkerRightClick = useCallback(
    (index: number) => {
      onChange(points.filter((_, i) => i !== index));
    },
    [points, onChange]
  );

  const handleUndo = () => onChange(points.slice(0, -1));
  const handleClear = () => onChange([]);

  const openJsonEditor = () => {
    setJsonText(
      JSON.stringify(
        points.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) })),
        null,
        2
      )
    );
    setJsonError("");
    setShowJson(true);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (
        !Array.isArray(parsed) ||
        parsed.some(
          (p: any) => typeof p.lat !== "number" || typeof p.lng !== "number"
        )
      ) {
        setJsonError('Expected array of {"lat": number, "lng": number}');
        return;
      }
      onChange(parsed);
      setShowJson(false);
      setJsonError("");
    } catch {
      setJsonError("Invalid JSON — check syntax");
    }
  };

  if (!isLoaded) {
    return (
      <div
        className="flex items-center justify-center h-80 rounded-xl border"
        style={{ borderColor: "var(--border)" }}
      >
        <Spinner size={24} />
      </div>
    );
  }

  const mapCenter =
    points.length > 0
      ? {
          lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
          lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
        }
      : center;

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={points.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30"
            style={{
              background: "var(--table-hover)",
              color: "var(--text-muted)",
            }}
          >
            <Undo2 size={12} /> Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={points.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 hover:text-red-400"
            style={{
              background: "var(--table-hover)",
              color: "var(--text-muted)",
            }}
          >
            <Eraser size={12} /> Clear
          </button>
          <button
            type="button"
            onClick={openJsonEditor}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "var(--table-hover)",
              color: "var(--text-muted)",
            }}
          >
            <Code2 size={12} /> Edit JSON
          </button>
        </div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {points.length === 0 ? (
            "Click on the map to add polygon points"
          ) : points.length < 3 ? (
            `${points.length} point${
              points.length > 1 ? "s" : ""
            } — need at least 3`
          ) : (
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle2 size={12} />
              {points.length} points — polygon ready
            </span>
          )}
        </div>
      </div>

      {/* Map */}
      <div
        className="rounded-xl overflow-hidden border"
        style={{ borderColor: "var(--border)" }}
      >
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "380px" }}
          center={mapCenter}
          zoom={points.length > 0 ? 15 : 13}
          onLoad={onMapLoad}
          onClick={handleMapClick}
          options={{
            mapTypeId: "satellite",
            disableDefaultUI: false,
            zoomControl: true,
            streetViewControl: false,
            mapTypeControl: true,
            fullscreenControl: true,
            clickableIcons: false,
          }}
        >
          {/* Polygon fill */}
          {points.length >= 3 && (
            <Polygon
              paths={points}
              options={{
                fillColor: "#f97316",
                fillOpacity: 0.25,
                strokeColor: "#f97316",
                strokeOpacity: 0.9,
                strokeWeight: 2,
              }}
            />
          )}

          {/* Vertex markers — draggable, right-click to delete */}
          {points.map((pt, i) => (
            <Marker
              key={i}
              position={pt}
              draggable
              onDragEnd={(e) => handleMarkerDrag(i, e)}
              onRightClick={() => handleMarkerRightClick(i)}
              title={`Point ${i + 1} — drag to move, right-click to remove`}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: i === 0 ? "#f97316" : "#fff",
                fillOpacity: 1,
                strokeColor: "#f97316",
                strokeWeight: 2,
              }}
            />
          ))}
        </GoogleMap>
      </div>

      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        Click to add points · Drag markers to adjust · Right-click marker to
        remove · Use satellite view for precision
      </p>

      {/* JSON editor modal */}
      {showJson && (
        <div
          className="rounded-xl border p-3 space-y-2"
          style={{
            borderColor: "var(--border)",
            background: "var(--table-hover)",
          }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium" style={{ color: "var(--text)" }}>
              Edit Polygon JSON
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Array of {`{"lat": number, "lng": number}`}
            </p>
          </div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={8}
            className="w-full rounded-lg p-2 text-xs font-mono resize-none border focus:outline-none"
            style={{
              background: "var(--bg)",
              color: "var(--text)",
              borderColor: jsonError ? "#ef4444" : "var(--border)",
            }}
            spellCheck={false}
          />
          {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowJson(false)}
              className="btn-ghost text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyJson}
              className="btn-primary text-xs"
            >
              Apply
            </button>
          </div>
          <div
            className="text-[10px] space-y-0.5"
            style={{ color: "var(--text-muted)" }}
          >
            <p className="font-medium">
              Tip — convert GeoJSON [lng, lat] to this format:
            </p>
            <p>
              GeoJSON: <code>[-0.1640, 51.1562]</code> → here:{" "}
              <code>{`{"lat": 51.1562, "lng": -0.1640}`}</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SurchargeZonesPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [polygonModalOpen, setPolygonModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Detection mode: "radius" | "polygon"
  const [detectionMode, setDetectionMode] = useState<"radius" | "polygon">(
    "radius"
  );
  const [polygonPoints, setPolygonPoints] = useState<LatLng[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["surcharge-zones"],
    queryFn: () => api.get("/admin/surcharge-zones").then((r) => r.data.data),
  });

  const { register, handleSubmit, reset, watch } = useForm({
    defaultValues: {
      name: "",
      type: "AIRPORT",
      latitude: 51.5074,
      longitude: -0.1278,
      radiusMeters: 500,
      pickupFee: 0,
      dropoffFee: 0,
      isActive: true,
      notes: "",
    },
  });

  const watchLat = watch("latitude");
  const watchLng = watch("longitude");

  const openCreate = () => {
    setEditing(null);
    setDetectionMode("radius");
    setPolygonPoints([]);
    reset({
      name: "",
      type: "AIRPORT",
      latitude: 51.5074,
      longitude: -0.1278,
      radiusMeters: 500,
      pickupFee: 0,
      dropoffFee: 0,
      isActive: true,
      notes: "",
    });
    setModalOpen(true);
  };

  const openEdit = (zone: any) => {
    setEditing(zone);
    const hasPolygon = Array.isArray(zone.polygon) && zone.polygon.length >= 3;
    setDetectionMode(hasPolygon ? "polygon" : "radius");
    setPolygonPoints(hasPolygon ? zone.polygon : []);
    reset({
      name: zone.name,
      type: zone.type,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radiusMeters: zone.radiusMeters,
      pickupFee: zone.pickupFee,
      dropoffFee: zone.dropoffFee,
      isActive: zone.isActive,
      notes: zone.notes ?? "",
    });
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editing
        ? api.put(`/admin/surcharge-zones/${editing.id}`, payload)
        : api.post("/admin/surcharge-zones", payload),
    onSuccess: () => {
      toast.success(editing ? "Zone updated" : "Zone created");
      qc.invalidateQueries({ queryKey: ["surcharge-zones"] });
      setModalOpen(false);
      reset();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to save"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/admin/surcharge-zones/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surcharge-zones"] }),
    onError: () => toast.error("Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/surcharge-zones/${id}`),
    onSuccess: () => {
      toast.success("Zone deleted");
      qc.invalidateQueries({ queryKey: ["surcharge-zones"] });
      setDeleteId(null);
    },
    onError: () => toast.error("Failed to delete"),
  });

  const onSubmit = (formData: any) => {
    const payload: any = { ...formData };

    if (detectionMode === "polygon") {
      if (polygonPoints.length < 3) {
        toast.error(
          "Polygon needs at least 3 points — draw it on the map first"
        );
        return;
      }
      // Compute centroid for lat/lng (used for map pin display)
      payload.latitude =
        polygonPoints.reduce((s, p) => s + p.lat, 0) / polygonPoints.length;
      payload.longitude =
        polygonPoints.reduce((s, p) => s + p.lng, 0) / polygonPoints.length;
      payload.polygon = polygonPoints;
    } else {
      // Radius mode — clear any existing polygon
      payload.polygon = null;
    }

    saveMutation.mutate(payload);
  };

  const zones: any[] = data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Surcharge Zones"
        subtitle={`${zones.length} zones — airports, hotels and venues with access fees`}
        action={
          <button
            onClick={openCreate}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={14} /> Add Zone
          </button>
        }
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Zone",
              "Type",
              "Detection",
              "Pick-up fee",
              "Drop-off fee",
              "Status",
              "",
            ]}
            isEmpty={!zones.length}
            emptyMessage="No surcharge zones yet — add Gatwick, Heathrow or any venue with access fees"
          >
            {zones.map((z: any) => {
              const hasPolygon =
                Array.isArray(z.polygon) && z.polygon.length >= 3;
              return (
                <tr key={z.id} className="table-row">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0">
                        <MapPin size={13} className="text-brand-400" />
                      </div>
                      <div>
                        <p
                          className="text-xs font-medium"
                          style={{ color: "var(--text)" }}
                        >
                          {z.name}
                        </p>
                        {z.notes && (
                          <p className="text-[10px] text-slate-500 truncate max-w-[200px]">
                            {z.notes}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-600">
                          {z.latitude.toFixed(4)}, {z.longitude.toFixed(4)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`badge text-[10px] ${
                        TYPE_COLOURS[z.type] ?? TYPE_COLOURS.OTHER
                      }`}
                    >
                      {z.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {hasPolygon ? (
                      <span className="flex items-center gap-1 text-[10px] text-orange-400 font-medium">
                        <Hexagon size={11} /> Polygon ({z.polygon.length} pts)
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Circle size={11} /> Radius {z.radiusMeters}m
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {z.pickupFee > 0 ? (
                      <span className="text-green-400 font-medium">
                        £{z.pickupFee.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {z.dropoffFee > 0 ? (
                      <span className="text-green-400 font-medium">
                        £{z.dropoffFee.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        toggleMutation.mutate({
                          id: z.id,
                          isActive: !z.isActive,
                        })
                      }
                      className="flex items-center gap-1.5 text-xs transition-colors"
                      style={{
                        color: z.isActive ? "var(--text-muted)" : "#64748b",
                      }}
                    >
                      {z.isActive ? (
                        <ToggleRight size={18} className="text-green-400" />
                      ) : (
                        <ToggleLeft size={18} className="text-slate-500" />
                      )}
                      <span>{z.isActive ? "Active" : "Inactive"}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(z)}
                        className="text-slate-500 hover:text-brand-400 transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setDeleteId(z.id)}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {/* Info box */}
      <div
        className="p-4 rounded-xl border text-xs space-y-1"
        style={{
          background: "var(--table-hover)",
          borderColor: "var(--border)",
          color: "var(--text-muted)",
        }}
      >
        <p className="font-semibold" style={{ color: "var(--text)" }}>
          How surcharge zones work
        </p>
        <p>
          When a booking pickup or dropoff falls within a zone, the fee is
          automatically added to the fare.
          <strong className="text-orange-400"> Polygon zones</strong> use exact
          boundary detection —{" "}
          <strong className="text-slate-300">Radius zones</strong> use a
          circular area from the centre point. Polygon takes priority when both
          are set.
        </p>
        <p className="mt-1">
          <strong>Radius guide:</strong> Airport terminal ~1000–2000m · Hotel
          forecourt ~100–200m · Stadium ~500m
        </p>
      </div>

      {/* ── Create / Edit Modal ──────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit — ${editing.name}` : "New Surcharge Zone"}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Zone name *
            </label>
            <input
              {...register("name", { required: true })}
              className="input"
              placeholder="e.g. Gatwick South Terminal"
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">Type</label>
            <select {...register("type")} className="input">
              {ZONE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Fees */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Pick-up fee (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("pickupFee", { valueAsNumber: true })}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Drop-off fee (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                {...register("dropoffFee", { valueAsNumber: true })}
                className="input"
              />
            </div>
          </div>

          {/* Detection Method */}
          <div>
            <label className="text-xs text-slate-400 block mb-2">
              Detection method
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDetectionMode("radius")}
                className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-medium transition-all ${
                  detectionMode === "radius"
                    ? "border-brand-500 bg-brand-500/10 text-brand-400"
                    : "border-slate-700 text-slate-400 hover:border-slate-500"
                }`}
              >
                <Circle size={14} /> Circle Radius
              </button>
              <button
                type="button"
                onClick={() => setDetectionMode("polygon")}
                className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-medium transition-all ${
                  detectionMode === "polygon"
                    ? "border-orange-500 bg-orange-500/10 text-orange-400"
                    : "border-slate-700 text-slate-400 hover:border-slate-500"
                }`}
              >
                <Hexagon size={14} /> Polygon (precise)
              </button>
            </div>
          </div>

          {/* Radius mode fields */}
          {detectionMode === "radius" && (
            <div
              className="space-y-3 p-3 rounded-xl border"
              style={{
                borderColor: "var(--border)",
                background: "var(--table-hover)",
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Latitude *
                  </label>
                  <input
                    type="number"
                    step="any"
                    {...register("latitude", {
                      required: true,
                      valueAsNumber: true,
                    })}
                    className="input"
                    placeholder="51.1537"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Longitude *
                  </label>
                  <input
                    type="number"
                    step="any"
                    {...register("longitude", {
                      required: true,
                      valueAsNumber: true,
                    })}
                    className="input"
                    placeholder="-0.1821"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Radius (metres)
                </label>
                <input
                  type="number"
                  {...register("radiusMeters", {
                    required: true,
                    valueAsNumber: true,
                  })}
                  className="input"
                />
              </div>
            </div>
          )}

          {/* Polygon mode — map editor */}
          {detectionMode === "polygon" && (
            <div
              className="space-y-2 p-3 rounded-xl border"
              style={{
                borderColor: "var(--border)",
                background: "var(--table-hover)",
              }}
            >
              <PolygonMapEditor
                points={polygonPoints}
                onChange={setPolygonPoints}
                center={{
                  lat: Number(watchLat) || 51.154,
                  lng: Number(watchLng) || -0.182,
                }}
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Notes (internal)
            </label>
            <input
              {...register("notes")}
              className="input"
              placeholder="e.g. Hilton access fee — pass-through only"
            />
          </div>

          {/* Active */}
          <div className="pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                {...register("isActive")}
                className="accent-brand-500"
              />
              <span className="text-xs" style={{ color: "var(--text)" }}>
                Active — apply this zone to fare estimates
              </span>
            </label>
          </div>

          <div
            className="pt-2 border-t flex justify-end gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saveMutation.isPending ? <Spinner size={14} /> : null}
              {editing ? "Save Changes" : "Create Zone"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Zone"
      >
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          Are you sure you want to delete this surcharge zone? This cannot be
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
            onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            disabled={deleteMutation.isPending}
            className="btn-danger flex items-center gap-2 text-sm"
          >
            {deleteMutation.isPending ? <Spinner size={14} /> : null} Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
