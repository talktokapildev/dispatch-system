"use client";
// admin/src/components/BookingFlightDetails.tsx
//
// Flight + airport pickup details in the booking modal.
//   Permanent (ours):  flight number, terminal, meeting point, luggage
//   Snapshot (AeroDataBox, deleted after 6 days): airline, origin, landing time
//   Tracking (step 6a): watch status, expected gate, last checked, pickup
//     booked → now, flight timeline (events + SMS/push), "Confirm earlier pickup"
// Also renders older bookings that only have a free-text flight/terminal.
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "@/lib/api";

type Snapshot = {
  flightNumber?: string;
  airlineName?: string | null;
  originName?: string | null;
  originIata?: string | null;
  scheduledArrivalUtc?: string;
  runwayArrivalUtc?: string | null;
  status?: string | null;
  quality?: string[];
};

type Watch = {
  status: string; // WATCHING | ARRIVED | CANCELLED | DIVERTED | ENDED
  expectedGateArrivalAt: string | null;
  actualGateArrivalAt: string | null;
  lastCheckedAt: string | null;
  unverified: boolean;
  endedAt: string | null;
};

type FlightEvent = {
  id: string;
  type: string;
  oldPickupAt: string | null;
  newPickupAt: string | null;
  note: string | null;
  smsSent: boolean;
  pushSent: boolean;
  createdAt: string;
};

const TERMINAL_LABEL: Record<string, string> = {
  NORTH: "North Terminal",
  SOUTH: "South Terminal",
};
const LUGGAGE_LABEL: Record<string, string> = {
  HAND: "Hand luggage only",
  CHECKED: "Checked bags",
};
const EVENT_LABEL: Record<string, string> = {
  RUNNING_LATE: "Running late",
  RUNNING_EARLY: "Running early",
  PICKUP_UPDATE: "Pickup updated",
  ARRIVED: "Landed",
  CANCELLED: "Flight cancelled",
  DIVERTED: "Flight diverted",
  UNVERIFIED: "⚠ Unverified",
  EARLIER_CONFIRMED: "Earlier pickup confirmed",
};
// Events that send messages (UNVERIFIED is admin-only).
const MESSAGING_EVENTS = new Set([
  "RUNNING_LATE",
  "RUNNING_EARLY",
  "PICKUP_UPDATE",
  "ARRIVED",
  "CANCELLED",
  "DIVERTED",
  "EARLIER_CONFIRMED",
]);

function ukTime(iso: string | null | undefined, withDate = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    ...(withDate && { day: "2-digit", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function minutesAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : ukTime(iso);
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-right" style={{ color: "var(--text)" }}>
        {children}
      </span>
    </div>
  );
}

function StatusChip({ booking }: { booking: any }) {
  const w: Watch | null = booking.flightWatch ?? null;
  const snap: Snapshot | null = booking.flightSnapshot ?? null;
  let label = "Not watched yet";
  let cls = "bg-slate-500/15 text-slate-400";
  if (w) {
    if (w.unverified && !["ARRIVED", "CANCELLED", "DIVERTED"].includes(w.status)) {
      label = "⚠ Unverified";
      cls = "bg-amber-500/15 text-amber-400";
    } else if (w.status === "WATCHING") {
      label = "Tracking";
      cls = "bg-blue-500/15 text-blue-400";
    } else if (w.status === "ARRIVED") {
      const landed =
        snap?.runwayArrivalUtc &&
        new Date(snap.runwayArrivalUtc).getTime() <= Date.now()
          ? snap.runwayArrivalUtc
          : w.actualGateArrivalAt;
      label = `Landed ${ukTime(landed, false)}`;
      cls = "bg-green-500/15 text-green-400";
    } else if (w.status === "CANCELLED" || w.status === "DIVERTED") {
      label = w.status === "CANCELLED" ? "Cancelled" : "Diverted";
      cls = "bg-red-500/15 text-red-400";
    } else {
      label = "Ended";
    }
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function ConfirmEarlier({
  booking,
  onChanged,
}: {
  booking: any;
  onChanged?: () => void;
}) {
  const earliestAt: string = booking.earlierPickup.earliestAt;
  const [time, setTime] = useState(ukTime(earliestAt, false));
  useEffect(() => setTime(ukTime(earliestAt, false)), [earliestAt]);

  const confirm = useMutation({
    mutationFn: () =>
      api.post(`/admin/bookings/${booking.id}/confirm-earlier`, {
        pickupTime: time,
      }),
    onSuccess: (r: any) => {
      const d = r.data.data;
      toast.success(
        `Pickup confirmed for ${ukTime(d.pickupAt, false)}${
          d.smsSent ? " · passenger texted" : " · SMS not sent"
        }${d.pushSent ? " · driver notified" : ""}`
      );
      onChanged?.();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Could not confirm"),
  });

  return (
    <div className="mt-2 p-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
      <p className="text-green-400 font-medium">Earlier pickup possible</p>
      <p className="text-slate-400 mt-0.5">
        Passenger can be ready from {ukTime(earliestAt, false)} (now{" "}
        {ukTime(booking.scheduledAt, false)}). Check the driver can make it,
        then confirm — the passenger is texted and the driver notified.
      </p>
      <div className="flex gap-2 mt-2">
        <input
          type="time"
          className="input w-28 py-1.5"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <button
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending || !time}
          className="btn-primary flex-1 py-1.5 text-xs disabled:opacity-40"
        >
          {confirm.isPending ? "Confirming…" : `Confirm pickup at ${time}`}
        </button>
      </div>
    </div>
  );
}

export function BookingFlightDetails({
  booking,
  onChanged,
}: {
  booking: any;
  onChanged?: () => void;
}) {
  const hasAirportPickup = !!booking.meetingPointId || !!booking.meetingPoint;
  if (!booking.flightNumber && !hasAirportPickup) return null;

  const snap: Snapshot | null = booking.flightSnapshot ?? null;
  const watch: Watch | null = booking.flightWatch ?? null;
  const events: FlightEvent[] = booking.flightEvents ?? [];
  const landing =
    snap?.scheduledArrivalUtc ?? booking.flightArrivalTime ?? null;
  const isTimetableOnly =
    Array.isArray(snap?.quality) &&
    snap!.quality.length > 0 &&
    snap!.quality.every((q) => q === "Basic");
  const tracked = !!booking.flightNumber && !!booking.meetingPointId;
  const gate = watch?.actualGateArrivalAt ?? watch?.expectedGateArrivalAt;
  const pickupMoved =
    booking.bookedPickupAt &&
    booking.scheduledAt &&
    booking.bookedPickupAt !== booking.scheduledAt;

  const title = booking.flightNumber
    ? [
        `✈ ${booking.flightNumber}`,
        snap?.airlineName,
        snap?.flightNumber &&
        snap.flightNumber.replace(/\s/g, "") !== booking.flightNumber
          ? `(${snap.flightNumber})`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "✈ Airport pickup";

  return (
    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="font-medium text-blue-400">{title}</p>
        {tracked && <StatusChip booking={booking} />}
      </div>

      {booking.flightNumber && snap?.originName && (
        <Row label="From">
          {snap.originName}
          {snap.originIata ? ` (${snap.originIata})` : ""}
        </Row>
      )}
      {booking.flightNumber && (
        <Row label="Scheduled landing">
          {landing ? ukTime(landing) : "Not stored"}
        </Row>
      )}
      {watch && gate && (
        <Row label={watch.actualGateArrivalAt ? "At gate" : "Expected at gate"}>
          {ukTime(gate)}
        </Row>
      )}
      {watch && (
        <Row label="Last checked">{minutesAgo(watch.lastCheckedAt)}</Row>
      )}
      {tracked && booking.scheduledAt && (
        <Row label="Pickup">
          {pickupMoved ? (
            <>
              <span className="text-slate-500 line-through mr-1">
                {ukTime(booking.bookedPickupAt, false)}
              </span>
              {ukTime(booking.scheduledAt)}
            </>
          ) : (
            ukTime(booking.scheduledAt)
          )}
          {booking.pickupOffsetMinutes != null && (
            <span className="text-slate-500">
              {" "}
              (gate + {booking.pickupOffsetMinutes} min)
            </span>
          )}
        </Row>
      )}
      {booking.terminal && (
        <Row label="Terminal">
          {TERMINAL_LABEL[booking.terminal] ?? booking.terminal}
        </Row>
      )}
      {booking.meetingPoint?.name && (
        <Row label="Meeting point">{booking.meetingPoint.name}</Row>
      )}
      {booking.luggageType && (
        <Row label="Luggage">
          {LUGGAGE_LABEL[booking.luggageType] ?? booking.luggageType}
        </Row>
      )}

      {booking.earlierPickup && (
        <ConfirmEarlier booking={booking} onChanged={onChanged} />
      )}

      {events.length > 0 && (
        <div className="mt-2 pt-2 border-t border-blue-500/20">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
            Flight timeline
          </p>
          {events.map((ev) => (
            <div key={ev.id} className="py-1">
              <div className="flex justify-between gap-2">
                <span style={{ color: "var(--text)" }}>
                  <span className="text-slate-500 mr-1.5">
                    {ukTime(ev.createdAt)}
                  </span>
                  {EVENT_LABEL[ev.type] ?? ev.type}
                </span>
                {MESSAGING_EVENTS.has(ev.type) && (
                  <span className="text-slate-500 shrink-0">
                    SMS {ev.smsSent ? "✓" : "–"} · Push{" "}
                    {ev.pushSent ? "✓" : "–"}
                  </span>
                )}
              </div>
              {ev.oldPickupAt &&
                ev.newPickupAt &&
                ev.oldPickupAt !== ev.newPickupAt && (
                  <p className="text-slate-500">
                    Pickup {ukTime(ev.oldPickupAt, false)} →{" "}
                    {ukTime(ev.newPickupAt, false)}
                  </p>
                )}
              {ev.note && <p className="text-slate-500">{ev.note}</p>}
            </div>
          ))}
        </div>
      )}

      {booking.flightNumber && (
        <div className="flex items-center justify-between gap-2 mt-2">
          <p className="text-[10px] text-slate-500">
            {snap && booking.flightSnapshotFetchedAt
              ? `Flight data as of ${ukTime(booking.flightSnapshotFetchedAt)}${
                  isTimetableOnly ? " (timetable)" : ""
                }${snap.status ? ` · ${snap.status}` : ""}`
              : booking.meetingPointId
              ? "Flight details are removed 6 days after lookup (data licence). Flight number, terminal and meeting point are kept."
              : "Flight details entered manually."}
          </p>
          <a
            href={`https://www.flightaware.com/live/flight/${encodeURIComponent(
              booking.flightNumber
            )}`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-blue-400 hover:underline shrink-0"
          >
            FlightAware ↗
          </a>
        </div>
      )}
    </div>
  );
}
