"use client";
// admin/src/components/VehicleHistory.tsx
//
// Who had which car and when (recorded automatically by the database whenever a car's driver
// changes). VehicleDriverHistory: on a vehicle's detail. DriverVehicleHistory: on a driver's detail.
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui";

const d = (iso?: string | null) => (iso ? format(new Date(iso), "dd MMM yyyy") : null);
const box = "p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]";

function Row({ who, from, to, reason, note }: { who: React.ReactNode; from: string; to?: string | null; reason?: string | null; note?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs py-1">
      <div className="min-w-0">
        <p className="text-[var(--text)] truncate">{who}</p>
        {(reason || note) && <p className="text-[10px] text-slate-500">{reason ?? note}</p>}
      </div>
      <p className="text-slate-400 whitespace-nowrap">
        {d(from)} → {to ? d(to) : <span className="text-green-400">now</span>}
      </p>
    </div>
  );
}

export function VehicleDriverHistory({ vehicleId }: { vehicleId: string }) {
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["vehicle-history", vehicleId],
    queryFn: () => api.get(`/admin/vehicles/${vehicleId}/history`).then((r) => r.data.data),
  });
  return (
    <div className={box}>
      {isLoading ? (
        <Spinner size={14} />
      ) : data.length === 0 ? (
        <p className="text-xs text-slate-500">No driver has had this vehicle yet.</p>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {data.map((a) => (
            <Row
              key={a.id}
              who={a.driverId ? <a href={`/drivers?open=${a.driverId}`} className="hover:text-brand-400">{a.driverName}</a> : `${a.driverName} (record deleted)`}
              from={a.startedAt}
              to={a.endedAt}
              reason={a.endReason}
              note={a.note}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DriverVehicleHistory({ driverId }: { driverId: string }) {
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["driver-vehicle-history", driverId],
    queryFn: () => api.get(`/admin/drivers/${driverId}/vehicle-history`).then((r) => r.data.data),
  });
  if (isLoading) return <Spinner size={14} />;
  if (!data.length) return <p className="text-xs text-slate-500">No vehicles recorded yet.</p>;
  return (
    <div className={`${box} divide-y divide-[var(--border)]`}>
      {data.map((a) => (
        <Row
          key={a.id}
          who={
            <a href={`/vehicles?id=${a.vehicleId}`} className="hover:text-brand-400">
              <span className="font-mono">{a.registration}</span> · {a.makeModel}
              {a.retired ? " (retired)" : ""}
            </a>
          }
          from={a.startedAt}
          to={a.endedAt}
          reason={a.endReason}
          note={a.note}
        />
      ))}
    </div>
  );
}
