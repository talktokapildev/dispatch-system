import React, { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { api, useAuthStore } from "../lib/api";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { decodePolyline, toMiles } from "../lib/mapUtils";
import AddressPicker from "../components/AddressPicker";
import TripMap from "../components/TripMap";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const GOOGLE_API_KEY = "AIzaSyAACxY0v2BlKtyW2BnNRjnGpuM1UjrRGWI";

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

export default function HomeScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const { user } = useAuthStore();
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
      setMyLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch {}
  };

  const fetchEstimate = async () => {
    if (!pickup || !dropoff) return;
    setEstimating(true);
    try {
      // ── Step 1: Get route from Google Directions ──────────────────────
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

      // ── Step 2: Get fare from our pricing engine ─────────────────────
      // Passing coordinates so surcharge zones are auto-detected server-side
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
    } catch (err) {
      // Silently fail — don't block booking, just hide the estimate
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
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${myLocation.latitude},${myLocation.longitude}&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      const address =
        json.results?.[0]?.formatted_address ?? "Current Location";
      setPickup({ address, ...myLocation });
    } catch {
      setPickup({ address: "Current Location", ...myLocation! });
    }
  };

  const proceedToConfirm = () => {
    if (!pickup || !dropoff) {
      Alert.alert("Missing addresses", "Please enter both pickup and dropoff.");
      return;
    }
    navigation.navigate("BookingConfirm", { pickup, dropoff, estimate });
  };

  const hasRoute = routeCoords.length > 1;
  const s = styles(Colors);

  return (
    <View style={s.container}>
      {/* Full-screen map */}
      <View style={StyleSheet.absoluteFill}>
        <TripMap
          passengerLocation={myLocation ?? undefined}
          pickup={pickup ?? undefined}
          dropoff={dropoff ?? undefined}
          routeCoords={hasRoute ? routeCoords : undefined}
          stage="booking"
          bottomPadding={SHEET_NORMAL + 20}
        />
      </View>

      {/* ── Bottom sheet ───────────────────────────────────────────────── */}
      <Animated.View style={[s.sheet, { height: sheetHeight }]}>
        {/* Drag handle */}
        <View style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        {/* Scrollable address pickers */}
        <ScrollView
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
        >
          <Text style={s.greeting}>
            {user?.firstName ? `Where to, ${user.firstName}?` : "Where to?"}
          </Text>

          <AddressPicker
            label="Pickup"
            icon="🟢"
            placeholder="Enter pickup address"
            value={pickup?.address ?? ""}
            onSelect={(r) => {
              setPickup(r);
              Keyboard.dismiss();
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

        {/* ── Fixed bottom section ───────────────────────────────────── */}
        <View style={s.bottomFixed}>
          {/* Estimating spinner */}
          {estimating && (
            <View style={s.estimateRow}>
              <ActivityIndicator size="small" color={Colors.brand} />
              <Text style={s.estimateLoading}>Calculating fare…</Text>
            </View>
          )}

          {/* Fare estimate card */}
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

          {/* Book button */}
          <TouchableOpacity
            style={[s.bookBtn, (!pickup || !dropoff) && s.bookBtnDisabled]}
            onPress={proceedToConfirm}
            activeOpacity={0.85}
            disabled={!pickup || !dropoff}
          >
            <Text style={s.bookBtnText}>
              {estimate
                ? `Book  ·  £${estimate.estimatedFare.toFixed(2)}`
                : "Book Ride →"}
            </Text>
          </TouchableOpacity>

          <View style={{ height: insets.bottom > 0 ? 0 : Spacing.md }} />
        </View>
      </Animated.View>
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
  });
