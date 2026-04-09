"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, useAuthStore } from "@/lib/api";
import { useSocket } from "@/lib/socket";
import { Badge, Modal } from "@/components/ui";
import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, RefreshCw, User } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

// ── Load Google Maps script once ─────────────────────────────────────────────
function useGoogleMaps() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).google?.maps) {
      setLoaded(true);
      return;
    }

    const existing = document.getElementById("google-maps-script");
    if (existing) {
      existing.addEventListener("load", () => setLoaded(true));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}`;
    script.async = true;
    script.onload = () => setLoaded(true);
    document.head.appendChild(script);
  }, []);

  return loaded;
}

// ── Driver colour by status ───────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: "#22c55e",
  ON_JOB: "#f59e0b",
  OFFLINE: "#64748b",
};

// ── Live map component ────────────────────────────────────────────────────────
function LiveMap({ drivers }: { drivers: any[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const mapsLoaded = useGoogleMaps();

  // Initialise map once
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || mapObj.current) return;
    mapObj.current = new (window as any).google.maps.Map(mapRef.current, {
      center: { lat: 51.1, lng: -0.18 }, // Crawley area default
      zoom: 11,
      mapTypeId: "roadmap",
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
      disableDefaultUI: false,
      zoomControl: true,
    });
  }, [mapsLoaded]);

  // Update driver markers whenever driver data changes
  useEffect(() => {
    if (!mapObj.current || !mapsLoaded) return;
    const google = (window as any).google;

    const seenIds = new Set<string>();

    drivers.forEach((driver) => {
      if (!driver.latitude || !driver.longitude) return;
      seenIds.add(driver.id);

      const pos = { lat: driver.latitude, lng: driver.longitude };
      const color = STATUS_COLOR[driver.status] ?? "#64748b";

      if (markersRef.current.has(driver.id)) {
        // Update existing marker position + icon
        const marker = markersRef.current.get(driver.id);
        marker.setPosition(pos);
        marker.setIcon(makeIcon(color));
        marker.setTitle(`${driver.name} (${driver.status})`);
      } else {
        // Create new marker
        const marker = new google.maps.Marker({
          position: pos,
          map: mapObj.current,
          title: `${driver.name} (${driver.status})`,
          icon: makeIcon(color),
          label: {
            text: driver.name?.[0] ?? "D",
            color: "#fff",
            fontSize: "11px",
            fontWeight: "bold",
          },
        });

        // Info window on click
        const info = new google.maps.InfoWindow({
          content: `
            <div style="font-family:sans-serif;padding:4px 2px;min-width:160px">
              <p style="font-weight:700;margin:0 0 2px">${driver.name}</p>
              <p style="margin:0;color:#64748b;font-size:12px">${
                driver.vehicle ?? ""
              } ${driver.vehicleClass ?? ""}</p>
              <p style="margin:4px 0 0;font-size:12px;color:${color};font-weight:600">${
            driver.status
          }</p>
            </div>
          `,
        });
        marker.addListener("click", () => info.open(mapObj.current, marker));
        markersRef.current.set(driver.id, marker);
      }
    });

    // Remove markers for drivers no longer in the list
    markersRef.current.forEach((marker, id) => {
      if (!seenIds.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });
  }, [drivers, mapsLoaded]);

  if (!GOOGLE_MAPS_KEY) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628]">
        <div className="text-center">
          <MapPin size={32} className="text-brand-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white">Live Driver Map</p>
          <p className="text-xs text-slate-500 mt-1">
            Add NEXT_PUBLIC_GOOGLE_MAPS_KEY to .env.local
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={mapRef} className="w-full h-full" />
      {!mapsLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628]">
          <p className="text-sm text-slate-400">Loading map…</p>
        </div>
      )}
    </div>
  );
}

function makeIcon(color: string) {
  return {
    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: 1.5,
    scale: 1.4,
    anchor: { x: 12, y: 22 } as any,
  };
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DispatchPage() {
  const { token } = useAuthStore();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [dispatchModal, setDispatchModal] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState("");

  const { refetch: refetchDrivers } = useQuery({
    queryKey: ["map-drivers"],
    queryFn: () =>
      api.get("/admin/map/drivers").then((r) => {
        setDrivers(r.data.data);
        return r.data.data;
      }),
    refetchInterval: 10_000,
  });

  const { data: pendingBookings, refetch: refetchPending } = useQuery({
    queryKey: ["pending-bookings"],
    queryFn: () =>
      api
        .get("/admin/bookings", { params: { status: "PENDING", limit: 20 } })
        .then((r) => r.data.data),
    refetchInterval: 10_000,
  });

  const { data: activeJobs, refetch: refetchActive } = useQuery({
    queryKey: ["active-jobs"],
    queryFn: () =>
      api
        .get("/admin/bookings", {
          params: {
            status:
              "DRIVER_ASSIGNED,DRIVER_EN_ROUTE,DRIVER_ARRIVED,IN_PROGRESS",
            limit: 30,
          },
        })
        .then((r) => r.data.data),
    refetchInterval: 10_000,
  });

  const dispatchMutation = useMutation({
    mutationFn: ({
      bookingId,
      driverId,
    }: {
      bookingId: string;
      driverId: string;
    }) => api.post(`/admin/bookings/${bookingId}/dispatch`, { driverId }),
    onSuccess: () => {
      toast.success("Driver assigned successfully");
      setDispatchModal(false);
      refetchPending();
      refetchActive();
    },
    onError: () => toast.error("Failed to assign driver"),
  });

  useSocket(token, {
    "admin:driver_update": (data: any) => {
      setDrivers((prev) =>
        prev.map((d) =>
          d.id === data.driverId
            ? {
                ...d,
                latitude: data.lat ?? d.latitude,
                longitude: data.lng ?? d.longitude,
                status: data.status ?? d.status,
              }
            : d
        )
      );
    },
    "admin:booking_created": () => {
      refetchPending();
      refetchActive();
    },
    "admin:booking_updated": () => {
      refetchPending();
      refetchActive();
    },
  });

  const availableDrivers = drivers.filter((d) => d.status === "AVAILABLE");
  const onJobDrivers = drivers.filter((d) => d.status === "ON_JOB");

  return (
    <div className="h-[calc(100vh-3rem)] flex gap-4 animate-fade-in">
      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div className="w-80 shrink-0 flex flex-col gap-4 overflow-y-auto">
        {/* Fleet summary */}
        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Fleet Status
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              {
                label: "Available",
                count: availableDrivers.length,
                color: "text-green-400",
              },
              {
                label: "On Job",
                count: onJobDrivers.length,
                color: "text-brand-400",
              },
              {
                label: "Offline",
                count: drivers.filter((d) => d.status === "OFFLINE").length,
                color: "text-slate-500",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="text-center p-2 rounded-lg bg-[var(--card-hover)]"
              >
                <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pending bookings */}
        <div className="card p-4 flex-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Needs Dispatch
              {pendingBookings?.total > 0 && (
                <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {pendingBookings.total}
                </span>
              )}
            </p>
            <button
              onClick={() => refetchPending()}
              className="text-slate-500 hover:text-white transition-colors"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {!pendingBookings?.items?.length ? (
              <p className="text-xs text-slate-600 text-center py-6">
                No pending bookings
              </p>
            ) : (
              pendingBookings.items.map((b: any) => (
                <div
                  key={b.id}
                  className="p-3 rounded-lg border border-[var(--border)] hover:border-brand-500/40 cursor-pointer transition-all bg-[var(--table-hover)]"
                  onClick={() => {
                    setSelectedBooking(b);
                    setDispatchModal(true);
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-brand-400">
                      {b.reference}
                    </span>
                    <span className="text-xs text-slate-500">
                      {format(new Date(b.createdAt), "HH:mm")}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-start gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 shrink-0" />
                      <p className="text-xs text-slate-300 leading-tight line-clamp-1">
                        {b.pickupAddress}
                      </p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                      <p className="text-xs text-slate-500 leading-tight line-clamp-1">
                        {b.dropoffAddress}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <Badge
                      status={b.type}
                      label={b.type.replace(/_/g, " ")}
                      className="text-[10px]"
                    />
                    <p className="text-xs font-semibold text-brand-400">
                      £{b.estimatedFare.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 card overflow-hidden relative">
        <LiveMap drivers={drivers} />

        {/* Driver list overlay — top right */}
        {drivers.length > 0 && (
          <div className="absolute top-3 right-3 space-y-1.5 z-10 max-h-64 overflow-y-auto">
            {drivers.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 bg-[var(--card)]/90 border border-[var(--border)] rounded-lg px-3 py-1.5 backdrop-blur text-xs"
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0`}
                  style={{
                    backgroundColor: STATUS_COLOR[d.status] ?? "#64748b",
                  }}
                />
                <span className="font-medium" style={{ color: "var(--text)" }}>
                  {d.name}
                </span>
                <span className="text-slate-500">{d.vehicle}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Right panel — active jobs ────────────────────────────────────── */}
      <div className="w-72 shrink-0 card p-4 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Active Jobs ({activeJobs?.total ?? 0})
        </p>
        <div className="space-y-2">
          {!activeJobs?.items?.length ? (
            <p className="text-xs text-slate-600 text-center py-6">
              No active jobs
            </p>
          ) : (
            activeJobs.items.map((b: any) => (
              <div
                key={b.id}
                className="p-3 rounded-lg border border-[var(--border)] bg-[var(--table-hover)] space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-brand-400">
                    {b.reference}
                  </span>
                  <Badge status={b.status} />
                </div>
                {b.driver && (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-brand-500/20 flex items-center justify-center">
                      <User size={10} className="text-brand-400" />
                    </div>
                    <div>
                      <p className="text-xs text-white">
                        {b.driver.user.firstName} {b.driver.user.lastName}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {b.driver.vehicle?.licensePlate}
                      </p>
                    </div>
                  </div>
                )}
                <div className="text-xs text-slate-500 space-y-0.5">
                  <p className="truncate">↑ {b.pickupAddress}</p>
                  <p className="truncate text-slate-600">
                    ↓ {b.dropoffAddress}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Manual dispatch modal ────────────────────────────────────────── */}
      <Modal
        open={dispatchModal}
        onClose={() => setDispatchModal(false)}
        title="Assign Driver"
      >
        {selectedBooking && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] space-y-1">
              <p className="text-xs text-brand-400 font-mono">
                {selectedBooking.reference}
              </p>
              <p className="text-sm text-white">
                {selectedBooking.pickupAddress}
              </p>
              <p className="text-xs text-slate-500">
                → {selectedBooking.dropoffAddress}
              </p>
              <p className="text-xs font-semibold text-brand-400 mt-1">
                £{selectedBooking.estimatedFare.toFixed(2)}
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-2 block">
                Select Available Driver
              </label>
              {!availableDrivers.length ? (
                <p className="text-xs text-red-400">No available drivers</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {availableDrivers.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDriver(d.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        selectedDriver === d.id
                          ? "border-brand-500/60 bg-brand-500/10"
                          : "border-[var(--border)] bg-[var(--table-hover)] hover:border-brand-500/30"
                      }`}
                    >
                      <p className="text-sm text-[var(--text)] font-medium">
                        {d.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {d.vehicle} · {d.vehicleClass}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() =>
                dispatchMutation.mutate({
                  bookingId: selectedBooking.id,
                  driverId: selectedDriver,
                })
              }
              disabled={!selectedDriver || dispatchMutation.isPending}
              className="btn-primary w-full justify-center flex"
            >
              {dispatchMutation.isPending ? "Assigning..." : "Assign Driver"}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
