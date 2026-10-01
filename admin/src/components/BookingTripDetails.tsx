"use client";
// admin/src/components/BookingTripDetails.tsx
//
// Booking modal extras: static route map + trip timeline.
// Data comes from:
//   GET /admin/bookings/:id/trip  (timeline, distances, which route is drawn)
//   GET /admin/bookings/:id/map   (PNG, fetched as a blob because the API
//                                  needs the auth header an <img> can't send)
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { api } from "@/lib/api";

type RouteSource = "actual" | "estimated" | "none";
type TimelineEvent = { key: string; label: string; at: string };
type TripData = {
  scheduledAt: string | null;
  timeline: TimelineEvent[];
  tripMinutes: number | null;
  actualDistanceMiles: number | null;
  actualDurationMinutes: number | null;
  routeSource: RouteSource;
};

const DOT_COLOR: Record<string, string> = {
  booked: "bg-slate-400",
  claimed: "bg-orange-400",
  dispatched: "bg-orange-400",
  accepted: "bg-orange-400",
  arrived: "bg-blue-400",
  started: "bg-blue-400",
  completed: "bg-green-500",
  ended: "bg-red-500",
};

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function routeCaption(source: RouteSource | undefined, status: string): string {
  if (source === "actual") return "Actual route (driver GPS)";
  if (source === "none") return "Route unavailable";
  if (status === "COMPLETED")
    return "Estimated route — actual route not recorded";
  return "Estimated route";
}

export function BookingTripDetails({ booking }: { booking: any }) {
  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ["booking-trip", booking.id, booking.status],
    queryFn: async () => {
      const { data } = await api.get(`/admin/bookings/${booking.id}/trip`);
      return data.data as TripData;
    },
    staleTime: 60_000,
  });

  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">(
    "loading"
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setMapState("loading");
    setMapUrl(null);

    api
      .get(`/admin/bookings/${booking.id}/map`, { responseType: "blob" })
      .then(({ data }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setMapUrl(objectUrl);
        setMapState("ready");
      })
      .catch(() => {
        if (!cancelled) setMapState("error");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [booking.id, booking.status]);

  const source = trip?.routeSource;
  const lineColor = source === "actual" ? "bg-orange-500" : "bg-blue-600";

  return (
    <>
      {/* ── Route map ── */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--card-hover)]">
        <div className="aspect-[2/1] w-full flex items-center justify-center">
          {mapState === "ready" && mapUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mapUrl}
              alt="Booking route map"
              className="w-full h-full object-cover"
            />
          ) : mapState === "error" ? (
            <p className="text-xs text-slate-500">Map unavailable</p>
          ) : (
            <p className="text-xs text-slate-500">Loading map…</p>
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-[10px] text-slate-500 border-t border-[var(--border)]">
          <span className="flex items-center gap-1.5">
            {source !== "none" && (
              <span
                className={`inline-block w-4 h-1 rounded-full ${lineColor}`}
              />
            )}
            {routeCaption(source, booking.status)}
          </span>
          <span>P = pickup · D = dropoff</span>
        </div>
      </div>

      {/* ── Trip timeline ── */}
      <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] text-xs">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Trip Timeline
        </p>

        {tripLoading && <p className="text-slate-500">Loading…</p>}

        {trip && (
          <>
            {trip.scheduledAt && (
              <div className="flex justify-between mb-2 pb-2 border-b border-[var(--border)]">
                <span className="text-slate-500">Scheduled pickup</span>
                <span style={{ color: "var(--text)" }} className="font-medium">
                  {format(new Date(trip.scheduledAt), "dd MMM yyyy HH:mm")}
                </span>
              </div>
            )}

            <ol className="space-y-1.5">
              {trip.timeline.map((e) => (
                <li key={e.key} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        DOT_COLOR[e.key] ?? "bg-slate-400"
                      }`}
                    />
                    <span className="text-slate-500">{e.label}</span>
                  </span>
                  <span
                    style={{ color: "var(--text)" }}
                    className="font-medium tabular-nums"
                  >
                    {format(new Date(e.at), "dd MMM HH:mm")}
                  </span>
                </li>
              ))}
            </ol>

            {(trip.tripMinutes !== null ||
              trip.actualDistanceMiles !== null) && (
              <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-[var(--border)]">
                <div>
                  <p className="text-slate-500 mb-0.5">Trip duration</p>
                  <p style={{ color: "var(--text)" }} className="font-medium">
                    {trip.tripMinutes !== null
                      ? formatMinutes(trip.tripMinutes)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 mb-0.5">Distance (actual)</p>
                  <p style={{ color: "var(--text)" }} className="font-medium">
                    {trip.actualDistanceMiles !== null
                      ? `${trip.actualDistanceMiles.toFixed(1)} mi`
                      : "—"}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
