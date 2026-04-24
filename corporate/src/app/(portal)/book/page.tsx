"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AddressPicker } from "@/components/AddressPicker";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import {
  MapPin,
  User,
  Phone,
  FileText,
  Clock,
  CheckCircle,
  Car,
} from "lucide-react";
import toast from "react-hot-toast";

interface Location {
  address: string;
  lat: number;
  lng: number;
}

export default function BookPage() {
  const router = useRouter();
  const [pickup, setPickup] = useState<Location>({
    address: "",
    lat: 0,
    lng: 0,
  });
  const [dropoff, setDropoff] = useState<Location>({
    address: "",
    lat: 0,
    lng: 0,
  });
  const [passengerName, setPassengerName] = useState("");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [isAsap, setIsAsap] = useState(true);
  const [estimate, setEstimate] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState<any>(null);

  useEffect(() => {
    if (pickup.lat && dropoff.lat) {
      getEstimate(pickup, dropoff);
    }
  }, [pickup.lat, dropoff.lat]);

  const getEstimate = async (p: Location, d: Location) => {
    if (!p.lat || !d.lat) return;
    setEstimating(true);
    try {
      // Detect airports by coordinates (more reliable than address strings)
      const isNearGatwick = (lat: number, lng: number) =>
        Math.abs(lat - 51.1537) < 0.02 && Math.abs(lng - -0.1821) < 0.02;

      const isNearHeathrow = (lat: number, lng: number) =>
        Math.abs(lat - 51.47) < 0.02 && Math.abs(lng - -0.4543) < 0.02;

      const isGatwickDrop = isNearGatwick(d.lat, d.lng);
      const isHeathrowDrop = isNearHeathrow(d.lat, d.lng);
      const isGatwickPick = isNearGatwick(p.lat, p.lng);
      const isHeathrowPick = isNearHeathrow(p.lat, p.lng);

      const bookingType =
        isGatwickDrop || isHeathrowDrop
          ? "AIRPORT_DROPOFF"
          : isGatwickPick || isHeathrowPick
          ? "AIRPORT_PICKUP"
          : "ASAP";

      const { data } = await api.post("/bookings/quote", {
        type: bookingType,
        pickupAddress: p.address,
        pickupLatitude: p.lat,
        pickupLongitude: p.lng,
        dropoffAddress: d.address,
        dropoffLatitude: d.lat,
        dropoffLongitude: d.lng,
        paymentMethod: "ACCOUNT",
      });
      setEstimate(data.data);
      //console.log("Quote response:", data.data);
    } catch {
      toast.error("Could not calculate fare");
    } finally {
      setEstimating(false);
    }
  };

  const handlePickup = (address: string, lat: number, lng: number) => {
    setPickup({ address, lat, lng });
  };

  const handleDropoff = (address: string, lat: number, lng: number) => {
    setDropoff({ address, lat, lng });
  };

  const submit = async () => {
    if (!pickup.lat || !dropoff.lat)
      return toast.error("Please enter pickup and dropoff addresses");
    if (!passengerName) return toast.error("Please enter passenger name");

    setBooking(true);
    try {
      const { data } = await api.post("/corporate/bookings", {
        pickupAddress: pickup.address,
        pickupLatitude: pickup.lat,
        pickupLongitude: pickup.lng,
        dropoffAddress: dropoff.address,
        dropoffLatitude: dropoff.lat,
        dropoffLongitude: dropoff.lng,
        passengerName,
        passengerPhone: passengerPhone || undefined,
        poNumber: poNumber || undefined,
        notes: notes || undefined,
        scheduledAt: isAsap ? undefined : scheduledAt || undefined,
        paymentMethod: "ACCOUNT",
      });
      setConfirmed(data.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Failed to create booking");
    } finally {
      setBooking(false);
    }
  };

  // Booking confirmed screen
  if (confirmed) {
    return (
      <div className="max-w-md mx-auto text-center py-16 animate-fade-in">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-green-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          Booking Confirmed
        </h1>
        <p className="text-slate-500 text-sm mb-1">Reference</p>
        <p className="text-2xl font-mono font-bold text-brand-500 mb-6">
          {confirmed.reference}
        </p>
        <div className="card p-4 text-left space-y-2 mb-6 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Passenger</span>
            <span className="font-medium text-slate-800">{passengerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Pickup</span>
            <span className="font-medium text-slate-800 text-right max-w-[200px]">
              {pickup.address}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Dropoff</span>
            <span className="font-medium text-slate-800 text-right max-w-[200px]">
              {dropoff.address}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Fare estimate</span>
            <span className="font-bold text-brand-500">
              £{confirmed.estimatedFare.toFixed(2)}
            </span>
          </div>
          {poNumber && (
            <div className="flex justify-between">
              <span className="text-slate-500">PO / Reference</span>
              <span className="font-medium text-slate-800">{poNumber}</span>
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => router.push("/bookings")}
            className="btn-ghost"
          >
            View Bookings
          </button>
          <button
            onClick={() => {
              setConfirmed(null);
              setPickup({ address: "", lat: 0, lng: 0 });
              setDropoff({ address: "", lat: 0, lng: 0 });
              setPassengerName("");
              setPassengerPhone("");
              setPoNumber("");
              setNotes("");
              setEstimate(null);
            }}
            className="btn-primary"
          >
            New Booking
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Book a Car</h1>
        <p className="page-subtitle">Arrange a ride for your team or guests</p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Form */}
        <div className="col-span-2 space-y-5">
          {/* Journey */}
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <MapPin size={14} className="text-brand-500" /> Journey
            </h2>
            <AddressPicker
              label="Pickup address"
              value={pickup.address}
              onChange={handlePickup}
              placeholder="Where from?"
            />
            <AddressPicker
              label="Dropoff address"
              value={dropoff.address}
              onChange={handleDropoff}
              placeholder="Where to?"
            />
          </div>

          {/* Timing */}
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Clock size={14} className="text-brand-500" /> Timing
            </h2>
            <div className="flex gap-3">
              <button
                onClick={() => setIsAsap(true)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                  isAsap
                    ? "bg-brand-500 text-white border-brand-500"
                    : "bg-white text-slate-600 border-slate-200 hover:border-brand-300"
                }`}
              >
                ASAP
              </button>
              <button
                onClick={() => setIsAsap(false)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                  !isAsap
                    ? "bg-brand-500 text-white border-brand-500"
                    : "bg-white text-slate-600 border-slate-200 hover:border-brand-300"
                }`}
              >
                Schedule
              </button>
            </div>
            {!isAsap && (
              <div>
                <label className="label">Date & time</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="input"
                  min={new Date().toISOString().slice(0, 16)}
                />
              </div>
            )}
          </div>

          {/* Passenger */}
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <User size={14} className="text-brand-500" /> Passenger Details
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Passenger name *</label>
                <input
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  placeholder="Full name"
                  className="input"
                />
              </div>
              <div>
                <label className="label">Mobile number</label>
                <div className="relative">
                  <Phone
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={passengerPhone}
                    onChange={(e) => setPassengerPhone(e.target.value)}
                    placeholder="+44 7700 000000"
                    className="input pl-8"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Reference */}
          <div className="card p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText size={14} className="text-brand-500" /> Reference &
              Notes
            </h2>
            <div>
              <label className="label">PO number / Cost centre</label>
              <input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="Optional — appears on invoice"
                className="input"
              />
            </div>
            <div>
              <label className="label">Special instructions</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Meet at Terminal 2 arrivals, passenger uses a walking stick"
                rows={3}
                className="input resize-none"
              />
            </div>
          </div>
        </div>

        {/* Fare summary */}
        <div className="space-y-4">
          <div className="card p-5 sticky top-6">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-4">
              <Car size={14} className="text-brand-500" /> Fare Estimate
            </h2>

            {!pickup.lat || !dropoff.lat ? (
              <p className="text-xs text-slate-400 text-center py-6">
                Enter addresses to see estimate
              </p>
            ) : estimating ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : estimate ? (
              <div className="space-y-2">
                <div className="text-3xl font-bold text-brand-500 mb-3">
                  £{(estimate.total ?? estimate.estimatedFare ?? 0).toFixed(2)}
                </div>
                <div className="text-xs space-y-1.5">
                  {(estimate.breakdown ?? []).map((line: string, i: number) => (
                    <div
                      key={i}
                      className="flex justify-between py-1 border-b border-slate-50"
                    >
                      <span className="text-slate-500">
                        {line.split(":")[0]}
                      </span>
                      <span className="font-medium text-slate-700">
                        {line.split(":")[1]?.trim()}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 pt-2">
                  Invoiced to account — 14-day payment terms
                </p>
              </div>
            ) : null}

            <button
              onClick={submit}
              disabled={
                booking || !pickup.lat || !dropoff.lat || !passengerName
              }
              className="btn-primary w-full mt-5 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {booking ? (
                <>
                  <Spinner size={14} /> Booking…
                </>
              ) : (
                "Confirm Booking"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Rough distance calc using Haversine — server recalculates accurately
function getDistanceMiles(p: Location, d: Location): number {
  const R = 3958.8;
  const dLat = deg2rad(d.lat - p.lat);
  const dLng = deg2rad(d.lng - p.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(p.lat)) *
      Math.cos(deg2rad(d.lat)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}
