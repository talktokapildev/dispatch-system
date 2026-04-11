import React, { useRef, useEffect } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { useTheme } from "../lib/ThemeContext";

interface LatLng {
  latitude: number;
  longitude: number;
}

interface TripMapProps {
  style?: ViewStyle;
  passengerLocation?: LatLng;
  driverLocation?: LatLng;
  pickup?: LatLng;
  dropoff?: LatLng;
  routeCoords?: LatLng[];
  stage?: "booking" | "tracking";
  bottomPadding?: number;
}

// Two overlapping points in London — invisible when strokeWidth=0.
// Keeping Polyline always mounted means first route arrival is a coordinate
// UPDATE (not a mount), which renders correctly on iOS + Google Maps provider.
const HIDDEN_COORDS = [
  { latitude: 51.5074, longitude: -0.1278 },
  { latitude: 51.5074, longitude: -0.1278 },
];

export default function TripMap({
  style,
  passengerLocation,
  driverLocation,
  pickup,
  dropoff,
  routeCoords,
  stage = "booking",
  bottomPadding = 0,
}: TripMapProps) {
  const { theme } = useTheme();
  const mapRef = useRef<MapView>(null);
  const hasRoute = !!routeCoords && routeCoords.length > 1;

  useEffect(() => {
    const coords: LatLng[] = [];

    if (hasRoute && routeCoords) {
      const step = Math.max(1, Math.floor(routeCoords.length / 20));
      for (let i = 0; i < routeCoords.length; i += step)
        coords.push(routeCoords[i]);
      coords.push(routeCoords[routeCoords.length - 1]);
    } else {
      if (passengerLocation) coords.push(passengerLocation);
      if (driverLocation) coords.push(driverLocation);
      if (pickup) coords.push(pickup);
      if (dropoff) coords.push(dropoff);
    }

    if (coords.length < 2) return;

    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: {
          top: 100,
          right: 80,
          bottom: bottomPadding + 80,
          left: 80,
        },
        animated: true,
      });
    }, 500);
  }, [
    hasRoute,
    routeCoords?.length,
    pickup?.latitude,
    pickup?.longitude,
    dropoff?.latitude,
    dropoff?.longitude,
    driverLocation?.latitude,
    driverLocation?.longitude,
    bottomPadding,
  ]);

  const darkMapStyle = [
    { elementType: "geometry", stylers: [{ color: "#0f1623" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0f1623" }] },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#1e2d42" }],
    },
    {
      featureType: "road",
      elementType: "geometry.stroke",
      stylers: [{ color: "#090d14" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [{ color: "#2d4464" }],
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [{ color: "#090d14" }],
    },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ];

  const center = pickup ??
    passengerLocation ?? { latitude: 51.505, longitude: -0.09 };

  return (
    <MapView
      ref={mapRef}
      style={[styles.map, style]}
      provider={PROVIDER_GOOGLE}
      customMapStyle={theme === "dark" ? darkMapStyle : []}
      initialRegion={{ ...center, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      showsTraffic={false}
      showsBuildings={false}
      moveOnMarkerPress={false}
    >
      {/*
        Always mounted — no key prop, no conditional rendering.
        Hidden via strokeWidth=0 until route arrives.
        This ensures first route render is a prop UPDATE not a MOUNT,
        which is what makes it work on iOS + Google Maps provider.
      */}
      <Polyline
        coordinates={hasRoute ? routeCoords! : HIDDEN_COORDS}
        strokeColor="#f59e0b"
        strokeColors={["#f59e0b"]}
        strokeWidth={hasRoute ? 5 : 0}
      />

      {/* Pickup dot (green) */}
      {pickup && (
        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 0.5 }} zIndex={2}>
          <View style={styles.pickupPin}>
            <View style={styles.pinInner} />
          </View>
        </Marker>
      )}

      {/* Dropoff dot (red) */}
      {dropoff && (
        <Marker coordinate={dropoff} anchor={{ x: 0.5, y: 0.5 }} zIndex={2}>
          <View style={styles.dropoffPin}>
            <View style={styles.pinInner} />
          </View>
        </Marker>
      )}

      {/* Driver dot (amber) */}
      {driverLocation && (
        <Marker
          coordinate={driverLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={3}
        >
          <View style={styles.driverPin}>
            <View style={styles.pinInner} />
          </View>
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  pickupPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#22c55e",
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#22c55e",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 8,
  },
  dropoffPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ef4444",
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 8,
  },
  driverPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f59e0b",
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f59e0b",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
  pinInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
});
