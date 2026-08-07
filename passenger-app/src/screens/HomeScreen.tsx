import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Dimensions,
  ScrollView,
  Platform,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import MapView from "react-native-maps";
import { api, useAuthStore } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { decodePolyline, toMiles } from "../lib/mapUtils";
import AddressPicker from "../components/AddressPicker";
import TripMap from "../components/TripMap";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const GOOGLE_API_KEY = "AIzaSyAACxY0v2BlKtyW2BnNRjnGpuM1UjrRGWI";
const MIN_LEAD_HOURS = 2; // must match ScheduledBookingService.hasMinimumLeadTime on backend
const MIN_LEAD_MS = MIN_LEAD_HOURS * 60 * 60 * 1000;

interface PlaceResult {
  address: string;
  latitude: number;
  longitude: number;
}

interface FareEstimate {
  estimatedFare: number;
  distanceKm: number;
  durationMins: number;
  polyline?: string;
}

// ── Crosshair icon — no @expo/vector-icons dependency ─────────────────────
function CrosshairIcon({ color, size = 20 }: { color: string; size?: number }) {
  const arm = size * 0.3;
  const dot = size * 0.18;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          width: arm,
          height: 1.5,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          right: 0,
          width: arm,
          height: 1.5,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          height: arm,
          width: 1.5,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 0,
          height: arm,
          width: 1.5,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// ── Latitude offset ────────────────────────────────────────────────────────
// animateToRegion centres the coordinate in the full MapView (including the
// portion hidden behind the bottom sheet). To make the pin appear in the
// centre of the *visible* area, we shift the map centre southward by half
// the sheet height expressed as a latitude fraction.
//
//   offset = (sheetHeight / 2 / SCREEN_HEIGHT) × latitudeDelta
//
// Subtracting this from the target latitude moves the map centre down so
// the pin sits visually centred above the sheet.
function visibleCentreLat(
  lat: number,
  latDelta: number,
  sheetHeight: number
): number {
  return lat - (sheetHeight / 2 / SCREEN_HEIGHT) * latDelta;
}

export default function HomeScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const { user, token } = useAuthStore();
  const insets = useSafeAreaInsets();

  const [pickup, setPickup] = useState<PlaceResult | null>(null);
  const [dropoff, setDropoff] = useState<PlaceResult | null>(null);
  const [myLocation, setMyLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [routeCoords, setRouteCoords] = useState<
    { latitude: number; longitude: number }[]
  >([]);

  const [bookingMode, setBookingMode] = useState<"ASAP" | "SCHEDULED">("ASAP");
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [showIosPicker, setShowIosPicker] = useState(false);
  const [iosTempDate, setIosTempDate] = useState<Date>(
    new Date(Date.now() + MIN_LEAD_MS)
  );
  const [androidStage, setAndroidStage] = useState<"date" | "time" | null>(
    null
  );
  const [androidTempDate, setAndroidTempDate] = useState<Date | null>(null);

  const mapRef = useRef<MapView>(null);
  const autoNavigatedRef = useRef<Set<string>>(new Set());
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const SHEET_NORMAL = estimate ? 370 + insets.bottom : 300 + insets.bottom;
  const SHEET_EXPANDED = SCREEN_HEIGHT - insets.top - 20;

  const sheetHeight = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_NORMAL, SHEET_EXPANDED],
  });

  useEffect(() => {
    getMyLocation();
    const showSub = Keyboard.addListener("keyboardWillShow", expand);
    const hideSub = Keyboard.addListener("keyboardWillHide", collapse);
    const showAndroid = Keyboard.addListener("keyboardDidShow", expand);
    const hideAndroid = Keyboard.addListener("keyboardDidHide", collapse);
    return () => {
      showSub.remove();
      hideSub.remove();
      showAndroid.remove();
      hideAndroid.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      const recover = async () => {
        try {
          const { data } = await api.get("/passengers/active-booking");
          const booking = data?.data;
          // Only auto-navigate the first time we see this booking as
          // "active" this session — otherwise every return to Home
          // re-triggers the redirect and traps the passenger here.
          if (booking && !autoNavigatedRef.current.has(booking.id)) {
            autoNavigatedRef.current.add(booking.id);
            const rootNav = navigation.getParent() ?? navigation;
            rootNav.navigate("Tracking", {
              bookingId: booking.id,
              booking,
            });
          }
        } catch {}
      };
      recover();
    }, [token])
  );

  const expand = () =>
    Animated.spring(sheetAnim, {
      toValue: 1,
      useNativeDriver: false,
      speed: 20,
    }).start();

  const collapse = () =>
    Animated.spring(sheetAnim, {
      toValue: 0,
      useNativeDriver: false,
      speed: 20,
    }).start();

  useEffect(() => {
    if (pickup && dropoff) fetchEstimate();
    else {
      setEstimate(null);
      setRouteCoords([]);
    }
  }, [pickup?.address, dropoff?.address]);

  const getMyLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setMyLocation(coords);

      // Centre visible area on user — offset latitude so pin sits in middle
      // of the map above the sheet, not in the middle of the full MapView.
      const delta = 0.05;
      setTimeout(() => {
        mapRef.current?.animateToRegion(
          {
            latitude: visibleCentreLat(coords.latitude, delta, SHEET_NORMAL),
            longitude: coords.longitude,
            latitudeDelta: delta,
            longitudeDelta: delta,
          },
          800
        );
      }, 600);
    } catch {}
  };

  const fetchEstimate = async () => {
    if (!pickup || !dropoff) return;
    setEstimating(true);
    try {
      const directionsUrl =
        `https://maps.googleapis.com/maps/api/directions/json` +
        `?origin=${pickup.latitude},${pickup.longitude}` +
        `&destination=${dropoff.latitude},${dropoff.longitude}` +
        `&key=${GOOGLE_API_KEY}`;

      const res = await fetch(directionsUrl);
      const json = await res.json();
      const leg = json.routes?.[0]?.legs?.[0];
      const polyline = json.routes?.[0]?.overview_polyline?.points;

      if (!leg) {
        setEstimate(null);
        return;
      }

      const distanceKm = (leg.distance?.value ?? 0) / 1000;
      const distanceMiles = distanceKm * 0.621371;
      const durationMins = Math.ceil((leg.duration?.value ?? 0) / 60);

      if (polyline) setRouteCoords(decodePolyline(polyline));

      const { data: priceData } = await api.post("/pricing/calculate", {
        distanceMiles,
        durationMinutes: durationMins,
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        dropoffLatitude: dropoff.latitude,
        dropoffLongitude: dropoff.longitude,
      });

      setEstimate({
        estimatedFare: priceData.data.total,
        distanceKm,
        durationMins,
        polyline,
      });
    } catch {
      setEstimate(null);
      setRouteCoords([]);
    } finally {
      setEstimating(false);
    }
  };

  const useMyLocationAsPickup = async () => {
    if (!myLocation) {
      Alert.alert(
        "Location unavailable",
        "Could not get your current location."
      );
      return;
    }

    // Animate immediately on tap for instant feedback.
    // delta 0.02 (~2 km) — street-level zoom.
    // Apply offset so pin appears in visible centre above the sheet.
    const delta = 0.02;
    mapRef.current?.animateToRegion(
      {
        latitude: visibleCentreLat(myLocation.latitude, delta, SHEET_NORMAL),
        longitude: myLocation.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      400
    );

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${myLocation.latitude},${myLocation.longitude}&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const address =
        json.results?.[0]?.formatted_address ?? "Current Location";
      setPickup({ address, ...myLocation });
    } catch {
      setPickup({ address: "Current Location", ...myLocation });
    }
  };

  const centreOnMe = () => {
    if (!myLocation) return;
    // delta 0.04 — neighbourhood-level overview.
    // Offset latitude so pin is visually centred in the area above the sheet.
    const delta = 0.04;
    mapRef.current?.animateToRegion(
      {
        latitude: visibleCentreLat(myLocation.latitude, delta, SHEET_NORMAL),
        longitude: myLocation.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      400
    );
  };

  const proceedToConfirm = () => {
    if (!pickup || !dropoff) {
      Alert.alert("Missing addresses", "Please enter both pickup and dropoff.");
      return;
    }
    if (bookingMode === "SCHEDULED" && !scheduledAt) {
      Alert.alert("Pick a time", "Please choose a pickup date and time.");
      return;
    }
    navigation.navigate("BookingConfirm", {
      pickup,
      dropoff,
      estimate,
      scheduledAt:
        bookingMode === "SCHEDULED" ? scheduledAt!.toISOString() : null,
    });
  };

  const validateAndSetSchedule = (date: Date) => {
    if (date.getTime() < Date.now() + MIN_LEAD_MS) {
      Alert.alert(
        "Too soon",
        `Scheduled bookings need at least ${MIN_LEAD_HOURS} hours' notice. Please pick a later time.`
      );
      return;
    }
    setScheduledAt(date);
  };

  const openSchedulePicker = () => {
    if (Platform.OS === "ios") {
      setIosTempDate(scheduledAt ?? new Date(Date.now() + MIN_LEAD_MS));
      setShowIosPicker(true);
    } else {
      // Android has no combined datetime mode — date dialog, then time dialog
      setAndroidStage("date");
    }
  };

  const onAndroidPickerChange = (
    event: DateTimePickerEvent,
    selected?: Date
  ) => {
    if (event.type === "dismissed" || !selected) {
      setAndroidStage(null);
      return;
    }
    if (androidStage === "date") {
      setAndroidTempDate(selected);
      setAndroidStage("time");
    } else if (androidStage === "time" && androidTempDate) {
      const combined = new Date(androidTempDate);
      combined.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      setAndroidStage(null);
      validateAndSetSchedule(combined);
    }
  };

  const confirmIosPicker = () => {
    setShowIosPicker(false);
    validateAndSetSchedule(iosTempDate);
  };

  const hasRoute = routeCoords.length > 1;
  const s = styles(Colors);

  return (
    <View style={s.container}>
      <View style={StyleSheet.absoluteFill}>
        <TripMap
          ref={mapRef}
          passengerLocation={myLocation ?? undefined}
          pickup={pickup ?? undefined}
          dropoff={dropoff ?? undefined}
          routeCoords={hasRoute ? routeCoords : undefined}
          stage="booking"
          bottomPadding={SHEET_NORMAL + 20}
        />
      </View>

      {myLocation && (
        <TouchableOpacity
          style={[s.locateBtn, { bottom: SHEET_NORMAL + 16 }]}
          onPress={centreOnMe}
          activeOpacity={0.85}
        >
          <CrosshairIcon color={Colors.brand} size={22} />
        </TouchableOpacity>
      )}

      <Animated.View style={[s.sheet, { height: sheetHeight }]}>
        <View style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
        >
          <Text style={s.greeting} numberOfLines={1} ellipsizeMode="tail">
            {user?.firstName ? `Where to, ${user.firstName}?` : "Where to?"}
          </Text>

          {/* When: Now vs Schedule — compact pill + inline date/time chip,
              merged into a single row to save vertical space */}
          <View style={s.scheduleRow}>
            <View style={s.modePill}>
              <TouchableOpacity
                style={[
                  s.modePillBtn,
                  bookingMode === "ASAP" && s.modePillBtnActive,
                ]}
                onPress={() => setBookingMode("ASAP")}
              >
                <Text
                  style={[
                    s.modePillText,
                    bookingMode === "ASAP" && s.modePillTextActive,
                  ]}
                >
                  Now
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.modePillBtn,
                  bookingMode === "SCHEDULED" && s.modePillBtnActive,
                ]}
                onPress={() => setBookingMode("SCHEDULED")}
              >
                <Text
                  style={[
                    s.modePillText,
                    bookingMode === "SCHEDULED" && s.modePillTextActive,
                  ]}
                >
                  Schedule
                </Text>
              </TouchableOpacity>
            </View>

            {bookingMode === "SCHEDULED" && (
              <TouchableOpacity
                style={s.scheduleChip}
                onPress={openSchedulePicker}
                activeOpacity={0.8}
              >
                <Text style={s.scheduleChipText} numberOfLines={1}>
                  {scheduledAt
                    ? `📅 ${scheduledAt.toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })} · ${scheduledAt.toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "📅 Pick time"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Android: sequential native date then time dialogs — these are
              native OS popups, zero layout footprint, no change needed */}
          {androidStage && (
            <DateTimePicker
              value={
                androidStage === "date"
                  ? androidTempDate ?? new Date(Date.now() + MIN_LEAD_MS)
                  : androidTempDate ?? new Date()
              }
              mode={androidStage}
              is24Hour
              minimumDate={androidStage === "date" ? new Date() : undefined}
              onChange={onAndroidPickerChange}
            />
          )}

          <AddressPicker
            label="Pickup"
            icon="🟢"
            placeholder="Enter pickup address"
            value={pickup?.address ?? ""}
            onSelect={(r) => {
              setPickup(r);
              Keyboard.dismiss();
              // Animate map to the selected pickup address.
              // If dropoff is also set, fitToCoordinates in TripMap will
              // take over and show the full route — this handles the
              // single-pickup case where the address may be off-screen.
              if (!dropoff) {
                const delta = 0.02;
                mapRef.current?.animateToRegion(
                  {
                    latitude: visibleCentreLat(r.latitude, delta, SHEET_NORMAL),
                    longitude: r.longitude,
                    latitudeDelta: delta,
                    longitudeDelta: delta,
                  },
                  500
                );
              }
            }}
            onClear={() => setPickup(null)}
          />

          <TouchableOpacity style={s.myLocBtn} onPress={useMyLocationAsPickup}>
            <Text style={s.myLocText}>📍 Use my current location</Text>
          </TouchableOpacity>

          <AddressPicker
            label="Dropoff"
            icon="🔴"
            placeholder="Enter dropoff address"
            value={dropoff?.address ?? ""}
            onSelect={(r) => {
              setDropoff(r);
              Keyboard.dismiss();
            }}
            onClear={() => setDropoff(null)}
          />
        </ScrollView>

        <View style={s.bottomFixed}>
          {estimating && (
            <View style={s.estimateRow}>
              <ActivityIndicator size="small" color={Colors.brand} />
              <Text style={s.estimateLoading}>Calculating fare…</Text>
            </View>
          )}

          {estimate && !estimating && (
            <View style={s.estimateCard}>
              <View style={s.estimateStat}>
                <Text style={s.estimateValue}>
                  £{estimate.estimatedFare.toFixed(2)}
                </Text>
                <Text style={s.estimateLabel}>Fare estimate</Text>
              </View>
              <View style={s.estimateDivider} />
              <View style={s.estimateStat}>
                <Text style={s.estimateValue}>
                  {toMiles(estimate.distanceKm)} mi
                </Text>
                <Text style={s.estimateLabel}>Distance</Text>
              </View>
              <View style={s.estimateDivider} />
              <View style={s.estimateStat}>
                <Text style={s.estimateValue}>
                  ~{estimate.durationMins} min
                </Text>
                <Text style={s.estimateLabel}>Duration</Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              s.bookBtn,
              (!pickup ||
                !dropoff ||
                (bookingMode === "SCHEDULED" && !scheduledAt)) &&
                s.bookBtnDisabled,
            ]}
            onPress={proceedToConfirm}
            activeOpacity={0.85}
            disabled={
              !pickup ||
              !dropoff ||
              (bookingMode === "SCHEDULED" && !scheduledAt)
            }
          >
            <Text style={s.bookBtnText}>
              {bookingMode === "SCHEDULED"
                ? estimate
                  ? `Schedule  ·  £${estimate.estimatedFare.toFixed(2)}`
                  : "Schedule Ride →"
                : estimate
                ? `Book  ·  £${estimate.estimatedFare.toFixed(2)}`
                : "Book Ride →"}
            </Text>
          </TouchableOpacity>

          <View style={{ height: insets.bottom > 0 ? 0 : Spacing.md }} />
        </View>
      </Animated.View>

      {/* iOS date/time picker — a real Modal, not inline, so the main sheet
          height never changes regardless of whether this is open */}
      <Modal
        visible={showIosPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIosPicker(false)}
      >
        <View style={s.pickerModalOverlay}>
          <View style={s.iosPickerCard}>
            <View style={s.iosPickerHeader}>
              <TouchableOpacity onPress={() => setShowIosPicker(false)}>
                <Text style={s.iosPickerCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.iosPickerTitle}>Pickup date & time</Text>
              <TouchableOpacity onPress={confirmIosPicker}>
                <Text style={s.iosPickerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={iosTempDate}
              mode="datetime"
              display="spinner"
              minimumDate={new Date(Date.now() + MIN_LEAD_MS)}
              onChange={(_event: DateTimePickerEvent, selected?: Date) =>
                selected && setIosTempDate(selected)
              }
              style={{ height: 200 }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    sheet: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      borderTopWidth: 1,
      borderColor: C.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 20,
      overflow: "hidden",
    },
    handleWrap: {
      alignItems: "center",
      paddingTop: Spacing.sm,
      paddingBottom: 0,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
    },
    scrollContent: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.sm,
    },
    greeting: {
      fontSize: FontSize.xl,
      fontWeight: "700",
      color: C.white,
      marginBottom: Spacing.md,
    },
    myLocBtn: { marginBottom: Spacing.sm, marginTop: -4 },
    scheduleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    modePill: {
      flexDirection: "row",
      backgroundColor: C.inputBg,
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: C.border,
      padding: 3,
    },
    modePillBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: Radius.full,
    },
    modePillBtnActive: {
      backgroundColor: C.brand,
    },
    modePillText: { fontSize: FontSize.xs, color: C.muted, fontWeight: "700" },
    modePillTextActive: { color: "#000" },
    scheduleChip: {
      flexShrink: 1,
      borderWidth: 1,
      borderColor: C.brand + "40",
      backgroundColor: C.brand + "10",
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: 8,
    },
    scheduleChipText: {
      fontSize: FontSize.xs,
      color: C.brand,
      fontWeight: "700",
    },
    pickerModalOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.4)",
    },
    iosPickerCard: {
      backgroundColor: C.card,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      borderTopWidth: 1,
      borderColor: C.border,
      paddingBottom: Spacing.xl,
      overflow: "hidden",
    },
    iosPickerHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    iosPickerCancel: { fontSize: FontSize.sm, color: C.muted },
    iosPickerTitle: {
      fontSize: FontSize.md,
      fontWeight: "700",
      color: C.white,
    },
    iosPickerDone: { fontSize: FontSize.sm, color: C.brand, fontWeight: "700" },
    myLocText: { fontSize: FontSize.xs, color: C.brand, fontWeight: "600" },
    bottomFixed: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      borderTopWidth: 1,
      borderTopColor: C.border,
      backgroundColor: C.card,
    },
    estimateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    estimateLoading: { fontSize: FontSize.sm, color: C.muted },
    estimateCard: {
      flexDirection: "row",
      backgroundColor: C.brand + "12",
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.brand + "30",
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      alignItems: "center",
    },
    estimateStat: { flex: 1, alignItems: "center" },
    estimateValue: { fontSize: FontSize.md, fontWeight: "800", color: C.brand },
    estimateLabel: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    estimateDivider: { width: 1, height: 28, backgroundColor: C.border },
    bookBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.lg,
      paddingVertical: Spacing.md + 2,
      alignItems: "center",
      marginBottom: Spacing.sm,
      shadowColor: C.brand,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 6,
    },
    bookBtnDisabled: { opacity: 0.35, shadowOpacity: 0 },
    bookBtnText: {
      color: "#000",
      fontWeight: "800",
      fontSize: FontSize.md,
      letterSpacing: 0.3,
    },
    locateBtn: {
      position: "absolute",
      right: 16,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 6,
    },
  });
