// passenger-app/src/components/AirportPickupSection.tsx
//
// Shown on HomeScreen when the pickup is at an airport with meeting points
// (decided by the backend from its surcharge zone, so "airport pickup" and
// "airport charge" always agree).
//
//   Now mode      → choose terminal (meeting point)
//   Schedule mode → enter flight → confirm terminal → luggage → pickup time
//                   (landing + buffer, "Need more time?" to move it later)
//                   or "Not flying" → choose terminal, pick time as usual
//
// The section replaces the pickup with the meeting point (via onUsePickup) so
// the fare is estimated for exactly where the booking will be made. All of
// this is re-validated server-side when the booking is created.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { api } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import TerminalPicker from "./TerminalPicker";
import NeedMoreTimeSheet from "./NeedMoreTimeSheet";
import {
  AirportBookingState,
  AirportInfo,
  FlightLookup,
  LuggageType,
  MeetingPoint,
  meetingPointAddress,
  toYmd,
  fromYmd,
  ukTime,
} from "../lib/airport";

type Place = { address: string; latitude: number; longitude: number };

type Props = {
  pickup: Place | null;
  bookingMode: "ASAP" | "SCHEDULED";
  onUsePickup: (place: Place) => void;
  onScheduledAtChange: (date: Date | null) => void;
  onChange: (state: AirportBookingState | null) => void;
  onCheckingChange?: (checking: boolean) => void; // HomeScreen disables Book while checking
};

const MIN_LEAD_MS = 2 * 60 * 60 * 1000; // must match backend ScheduledBookingService

export default function AirportPickupSection({
  pickup,
  bookingMode,
  onUsePickup,
  onScheduledAtChange,
  onChange,
  onCheckingChange,
}: Props) {
  const { Colors } = useTheme();
  const s = styles(Colors);

  const [airport, setAirport] = useState<AirportInfo | null>(null);
  const airportRef = useRef<AirportInfo | null>(null);
  const [meetingPoint, setMeetingPoint] = useState<MeetingPoint | null>(null);
  const appliedAddress = useRef<string | null>(null);

  // Flight
  const [skipFlight, setSkipFlight] = useState(false);
  const [flightNumber, setFlightNumber] = useState("");
  const [flightDate, setFlightDate] = useState(toYmd(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [iosTempDate, setIosTempDate] = useState(new Date());
  const [lookup, setLookup] = useState<FlightLookup | null>(null);
  const [lookupInput, setLookupInput] = useState<{
    number: string;
    date: string;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [luggage, setLuggage] = useState<LuggageType>("CHECKED");
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [customTime, setCustomTime] = useState<Date | null>(null);
  const [showMoreTime, setShowMoreTime] = useState(false);
  const flightTimeActive = useRef(false);

  const resetFlight = () => {
    setLookup(null);
    setLookupInput(null);
    setLookupError(null);
    setExtraMinutes(0);
    setCustomTime(null);
  };

  const resetAll = () => {
    setMeetingPoint(null);
    appliedAddress.current = null;
    setSkipFlight(false);
    resetFlight();
  };

  // ── Is the pickup at an airport? (backend checks its surcharge zones) ──
  useEffect(() => {
    if (!pickup) {
      airportRef.current = null;
      setAirport(null);
      resetAll();
      onCheckingChange?.(false);
      return;
    }
    // Passenger typed a different pickup → forget the previous terminal choice.
    if (pickup.address !== appliedAddress.current) {
      setMeetingPoint(null);
      appliedAddress.current = null;
    }
    let cancelled = false;
    onCheckingChange?.(true);
    api
      .get("/flights/airport-pickup", {
        params: { lat: pickup.latitude, lng: pickup.longitude },
      })
      .then(({ data }: any) => {
        if (cancelled) return;
        const next: AirportInfo | null = data?.data ?? null;
        const prevIata = airportRef.current?.airportIata;
        if (!next || (prevIata && prevIata !== next.airportIata)) resetAll();
        airportRef.current = next;
        setAirport(next);
        onCheckingChange?.(false);
      })
      .catch(() => {
        if (cancelled) return;
        airportRef.current = null;
        setAirport(null);
        onCheckingChange?.(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickup?.latitude, pickup?.longitude]);

  const selectMeetingPoint = (mp: MeetingPoint) => {
    if (!airport) return;
    setMeetingPoint(mp);
    const place = {
      address: meetingPointAddress(airport.airportName, mp),
      latitude: mp.latitude,
      longitude: mp.longitude,
    };
    appliedAddress.current = place.address;
    onUsePickup(place);
  };

  // ── Flight lookup ─────────────────────────────────────────────────────
  const findFlight = async () => {
    const number = flightNumber.trim();
    if (!number) return;
    setSearching(true);
    setLookupError(null);
    try {
      const { data } = await api.get("/flights/lookup", {
        params: { number, date: flightDate },
      });
      const result: FlightLookup = data.data;
      setLookup(result);
      setLookupInput({ number, date: flightDate });
      setExtraMinutes(0);
      setCustomTime(null);
      if (result.suggestedMeetingPoint)
        selectMeetingPoint(result.suggestedMeetingPoint);
    } catch (err: any) {
      setLookupError(
        err.response?.data?.error ??
          "Couldn't look up that flight. Please try again."
      );
    } finally {
      setSearching(false);
    }
  };

  // ── Derived pickup time for a found flight ────────────────────────────
  const timing = useMemo(() => {
    if (!lookup) return null;
    const earliest = new Date(
      luggage === "HAND"
        ? lookup.earliestPickupUtc.hand
        : lookup.earliestPickupUtc.checked
    );
    const pickupAt =
      customTime && customTime >= earliest
        ? customTime
        : new Date(earliest.getTime() + extraMinutes * 60_000);
    const bufferMinutes =
      luggage === "HAND" ? lookup.buffers.hand : lookup.buffers.checked;
    const tooSoon = pickupAt.getTime() < Date.now() + MIN_LEAD_MS;
    return { earliest, pickupAt, bufferMinutes, tooSoon };
  }, [lookup, luggage, extraMinutes, customTime]);

  const usingFlight =
    !!airport &&
    bookingMode === "SCHEDULED" &&
    !skipFlight &&
    !!lookup &&
    !!lookupInput &&
    !!timing;

  // Push the flight-based pickup time to HomeScreen (and clear it once, when the flight is removed).
  useEffect(() => {
    if (usingFlight && timing) {
      flightTimeActive.current = true;
      onScheduledAtChange(timing.pickupAt);
    } else if (flightTimeActive.current) {
      flightTimeActive.current = false;
      onScheduledAtChange(null);
    }
  }, [usingFlight, timing?.pickupAt.getTime()]);

  // ── Report state to HomeScreen ────────────────────────────────────────
  useEffect(() => {
    if (!airport) {
      onChange(null);
      return;
    }
    let ready = !!meetingPoint;
    let message: string | null = meetingPoint
      ? null
      : "Please choose your terminal.";

    if (bookingMode === "SCHEDULED" && !skipFlight) {
      if (!lookup) {
        ready = false;
        message = 'Add your flight, or tap "Not flying".';
      } else if (timing?.tooSoon) {
        ready = false;
        message =
          'This flight lands too soon for a scheduled pickup. Book with "Now" after you land.';
      }
    }

    onChange({
      airportName: airport.airportName,
      meetingPoint,
      flight:
        usingFlight && lookup && lookupInput && timing
          ? {
              flightNumber: lookupInput.number,
              flightDate: lookupInput.date,
              luggageType: luggage,
              display: [lookup.flight.flightNumber, lookup.flight.airlineName]
                .filter(Boolean)
                .join(" · "),
              originName: lookup.flight.originName,
              scheduledArrivalUtc: lookup.flight.scheduledArrivalUtc,
              expectedArrivalUtc:
                lookup.flight.expectedArrivalUtc ??
                lookup.flight.scheduledArrivalUtc,
              bufferMinutes: timing.bufferMinutes,
            }
          : null,
      ready,
      message,
    });
  }, [
    airport,
    meetingPoint,
    bookingMode,
    skipFlight,
    lookup,
    lookupInput,
    luggage,
    timing?.pickupAt.getTime(),
    timing?.tooSoon,
  ]);

  // ── Date picker (flight arrival date) ─────────────────────────────────
  const today = new Date();
  const maxDate = new Date(Date.now() + 180 * 86_400_000);
  const onAndroidDate = (event: DateTimePickerEvent, d?: Date) => {
    setShowDatePicker(false);
    if (event.type !== "dismissed" && d) setFlightDate(toYmd(d));
  };

  if (!airport) return null;

  const meetingPoints = lookup?.meetingPoints?.length
    ? lookup.meetingPoints
    : airport.meetingPoints;

  // Now mode, or "Not flying" → terminal only.
  if (bookingMode === "ASAP" || skipFlight) {
    return (
      <View style={s.box}>
        <Text style={s.airportTag}>
          ✈ {airport.airportName} pickup · which terminal?
        </Text>
        <TerminalPicker
          meetingPoints={airport.meetingPoints}
          selectedId={meetingPoint?.id ?? null}
          onSelect={selectMeetingPoint}
          title={null}
          compact
        />
        {bookingMode === "SCHEDULED" && (
          <TouchableOpacity
            onPress={() => setSkipFlight(false)}
            style={s.linkBtn}
          >
            <Text style={s.link}>Add your flight instead</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Schedule mode, flight not found yet → entry.
  if (!lookup || !timing) {
    return (
      <View style={s.box}>
        <Text style={s.title}>✈ Arriving on a flight?</Text>
        <Text style={s.sub}>
          Add it and we'll time your pickup to your landing.
        </Text>
        <View style={s.inputRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={flightNumber}
            onChangeText={(t: string) => {
              setFlightNumber(t);
              setLookupError(null);
            }}
            placeholder="e.g. EZY8004"
            placeholderTextColor={Colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={findFlight}
          />
          <TouchableOpacity
            style={s.dateBtn}
            onPress={() => {
              setIosTempDate(fromYmd(flightDate));
              setShowDatePicker(true);
            }}
          >
            <Text style={s.dateText}>
              {fromYmd(flightDate).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </Text>
          </TouchableOpacity>
        </View>
        {lookupError && <Text style={s.error}>{lookupError}</Text>}
        <View style={s.rowBetween}>
          <TouchableOpacity onPress={() => setSkipFlight(true)}>
            <Text style={s.mutedLink}>Not flying</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.findBtn, !flightNumber.trim() && { opacity: 0.5 }]}
            onPress={findFlight}
            disabled={!flightNumber.trim() || searching}
          >
            {searching ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={s.findText}>Find flight</Text>
            )}
          </TouchableOpacity>
        </View>

        {showDatePicker && Platform.OS === "android" && (
          <DateTimePicker
            value={fromYmd(flightDate)}
            mode="date"
            minimumDate={today}
            maximumDate={maxDate}
            onChange={onAndroidDate}
          />
        )}
        <Modal
          visible={showDatePicker && Platform.OS === "ios"}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={s.overlay}>
            <View style={s.pickerCard}>
              <View style={s.rowBetween}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={s.mutedLink}>Cancel</Text>
                </TouchableOpacity>
                <Text style={s.title}>Arrival date</Text>
                <TouchableOpacity
                  onPress={() => {
                    setFlightDate(toYmd(iosTempDate));
                    setShowDatePicker(false);
                  }}
                >
                  <Text style={s.link}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={iosTempDate}
                mode="date"
                display="spinner"
                minimumDate={today}
                maximumDate={maxDate}
                onChange={(_e: DateTimePickerEvent, d?: Date) =>
                  d && setIosTempDate(d)
                }
                style={{ height: 200 }}
              />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Schedule mode, flight found.
  const f = lookup.flight;
  const expected = f.expectedArrivalUtc ?? f.scheduledArrivalUtc;
  const changed =
    Math.abs(
      new Date(expected).getTime() - new Date(f.scheduledArrivalUtc).getTime()
    ) >=
    5 * 60_000;
  const uncertain = f.confidence === "UNCERTAIN";
  const later = customTime
    ? Math.round(
        (timing.pickupAt.getTime() - timing.earliest.getTime()) / 60_000
      )
    : extraMinutes;

  return (
    <View style={s.box}>
      <View style={s.rowBetween}>
        <Text style={s.title}>
          ✈ {[f.flightNumber, f.airlineName].filter(Boolean).join(" · ")}
        </Text>
        <TouchableOpacity onPress={resetFlight}>
          <Text style={s.mutedLink}>Change</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.sub}>
        {f.originName ? `From ${f.originName} · ` : ""}
        {changed
          ? `Scheduled ${ukTime(f.scheduledArrivalUtc)} · now expected ${ukTime(
              expected
            )} (UK time)`
          : `Lands ${ukTime(f.scheduledArrivalUtc)} (UK time)`}
      </Text>

      <TerminalPicker
        meetingPoints={meetingPoints}
        selectedId={meetingPoint?.id ?? null}
        onSelect={selectMeetingPoint}
        title={
          f.terminal ? "Arriving at" : "Which terminal are you arriving at?"
        }
        compact
      />

      <Text style={[s.title, { marginTop: Spacing.md }]}>Luggage</Text>
      <View style={s.segment}>
        {(["HAND", "CHECKED"] as LuggageType[]).map((l) => (
          <TouchableOpacity
            key={l}
            style={[s.segBtn, luggage === l && s.segBtnActive]}
            onPress={() => setLuggage(l)}
          >
            <Text style={[s.segText, luggage === l && s.segTextActive]}>
              {l === "HAND" ? "Hand luggage only" : "Checked bags"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {uncertain && !timing.tooSoon && (
        <View style={s.uncertainBox}>
          <Text style={s.uncertainTitle}>
            {f.flightNumber} is delayed. The new landing time isn't confirmed
            yet.
          </Text>
          <Text style={s.uncertainText}>
            No need to choose a pickup time. We'll track your flight and set
            your pickup for {timing.bufferMinutes} minutes after it lands, and
            text you the exact time when you land.
          </Text>
          <Text style={s.uncertainHint}>
            Prefer to wait? Book with "Now" once you've landed.
          </Text>
        </View>
      )}

      <View style={[s.timeBox, timing.tooSoon && s.timeBoxWarn]}>
        <Text style={[s.timeMain, timing.tooSoon && { color: Colors.danger }]}>
          {uncertain && !timing.tooSoon
            ? `Current estimate: around ${ukTime(timing.pickupAt)}`
            : `Pickup ${ukTime(timing.pickupAt)}`}
        </Text>
        <Text style={[s.timeSub, timing.tooSoon && { color: Colors.danger }]}>
          {timing.tooSoon
            ? 'Too soon to schedule. Book with "Now" after you land.'
            : uncertain
            ? "We'll update this as your flight progresses"
            : `${timing.bufferMinutes} min after landing${
                later > 0 ? ` + ${later} min` : ""
              }`}
        </Text>
      </View>
      {!timing.tooSoon && (
        <TouchableOpacity
          onPress={() => setShowMoreTime(true)}
          style={s.linkBtn}
        >
          <Text style={s.link}>Need more time?</Text>
        </TouchableOpacity>
      )}

      <NeedMoreTimeSheet
        visible={showMoreTime}
        earliest={timing.earliest}
        landingUtc={expected}
        onClose={() => setShowMoreTime(false)}
        onSelect={(choice) => {
          if ("custom" in choice) {
            setCustomTime(choice.custom);
            setExtraMinutes(0);
          } else {
            setExtraMinutes(choice.extraMinutes);
            setCustomTime(null);
          }
          setShowMoreTime(false);
        }}
      />
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    // Option B: visually attached to the pickup field above it — tinted card,
    // square top tucked under the pickup input.
    box: {
      borderWidth: 1,
      borderColor: C.brand + "40",
      borderTopWidth: 0,
      borderBottomLeftRadius: Radius.lg,
      borderBottomRightRadius: Radius.lg,
      marginTop: -Spacing.md,
      paddingTop: Spacing.md + Spacing.md,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.md,
      marginBottom: Spacing.sm,
      backgroundColor: C.brand + "0D",
      zIndex: -1,
    },
    uncertainBox: {
      marginTop: Spacing.md,
      borderRadius: Radius.md,
      padding: Spacing.md,
      backgroundColor: C.brand + "1A",
    },
    uncertainTitle: {
      fontSize: FontSize.sm,
      color: C.white,
      fontWeight: "700",
    },
    uncertainText: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 4,
      lineHeight: 18,
    },
    uncertainHint: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 6,
      fontStyle: "italic",
    },
    airportTag: {
      fontSize: FontSize.xs,
      color: C.brand,
      fontWeight: "700",
      marginBottom: Spacing.sm,
    },
    title: { fontSize: FontSize.sm, color: C.white, fontWeight: "700" },
    sub: {
      fontSize: FontSize.xs,
      color: C.muted,
      marginTop: 2,
      marginBottom: Spacing.sm,
    },
    inputRow: { flexDirection: "row", gap: Spacing.sm },
    input: {
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      color: C.white,
      fontSize: FontSize.sm,
    },
    dateBtn: {
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      justifyContent: "center",
    },
    dateText: { color: C.white, fontSize: FontSize.sm },
    error: { color: C.danger, fontSize: FontSize.xs, marginTop: Spacing.sm },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: Spacing.sm,
    },
    findBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      minWidth: 100,
      alignItems: "center",
    },
    findText: { color: "#000", fontWeight: "800", fontSize: FontSize.sm },
    link: { color: C.brand, fontSize: FontSize.sm, fontWeight: "600" },
    mutedLink: { color: C.muted, fontSize: FontSize.sm },
    linkBtn: { marginTop: Spacing.sm },
    segment: {
      flexDirection: "row",
      backgroundColor: C.inputBg,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: Radius.md,
      padding: 2,
      marginTop: Spacing.sm,
    },
    segBtn: {
      flex: 1,
      alignItems: "center",
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
    },
    segBtnActive: { backgroundColor: C.brand },
    segText: { fontSize: FontSize.xs, color: C.muted, fontWeight: "600" },
    segTextActive: { color: "#000" },
    timeBox: {
      marginTop: Spacing.md,
      backgroundColor: C.success + "1A",
      borderRadius: Radius.md,
      padding: Spacing.md,
    },
    timeBoxWarn: { backgroundColor: C.danger + "1A" },
    timeMain: { fontSize: FontSize.md, color: C.success, fontWeight: "800" },
    timeSub: { fontSize: FontSize.xs, color: C.success, marginTop: 2 },
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    pickerCard: {
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      padding: Spacing.lg,
      paddingBottom: Spacing.xl,
    },
  });
