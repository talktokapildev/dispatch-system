"use client";
// admin/src/components/BookingFlightDetails.tsx
//
// Flight + airport pickup details in the booking modal.
//   Permanent (ours):  flight number, terminal, meeting point, luggage
//   Snapshot (AeroDataBox, deleted after 6 days): airline, origin, landing time
// Also renders older bookings that only have a free-text flight/terminal.

type Snapshot = {
  flightNumber?: string;
  airlineName?: string | null;
  originName?: string | null;
  originIata?: string | null;
  scheduledArrivalUtc?: string;
  status?: string | null;
  quality?: string[];
};

const TERMINAL_LABEL: Record<string, string> = {
  NORTH: "North Terminal",
  SOUTH: "South Terminal",
};
const LUGGAGE_LABEL: Record<string, string> = {
  HAND: "Hand luggage only",
  CHECKED: "Checked bags",
};

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

export function BookingFlightDetails({ booking }: { booking: any }) {
  const hasAirportPickup = !!booking.meetingPointId || !!booking.meetingPoint;
  if (!booking.flightNumber && !hasAirportPickup) return null;

  const snap: Snapshot | null = booking.flightSnapshot ?? null;
  const landing =
    snap?.scheduledArrivalUtc ?? booking.flightArrivalTime ?? null;
  const isTimetableOnly =
    Array.isArray(snap?.quality) &&
    snap!.quality.length > 0 &&
    snap!.quality.every((q) => q === "Basic");

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
      <p className="font-medium text-blue-400 mb-1">{title}</p>

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

      {booking.flightNumber && (
        <p className="text-[10px] text-slate-500 mt-2">
          {snap && booking.flightSnapshotFetchedAt
            ? `Flight data as of ${ukTime(booking.flightSnapshotFetchedAt)}${
                isTimetableOnly ? " (timetable)" : ""
              }${snap.status ? ` · ${snap.status}` : ""}`
            : booking.meetingPointId
            ? "Flight details are removed 6 days after lookup (data licence). Flight number, terminal and meeting point are kept."
            : "Flight details entered manually."}
        </p>
      )}
    </div>
  );
}
