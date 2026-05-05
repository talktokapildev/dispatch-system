import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import { useTheme } from "../lib/ThemeContext";

interface Props {
  driverLocation?: { latitude: number; longitude: number };
  pickup: { latitude: number; longitude: number };
  dropoff?: { latitude: number; longitude: number };
  routeCoords?: { latitude: number; longitude: number }[];
  stage: "offer" | "to_pickup" | "to_dropoff";
  bottomPadding?: number; // ← add this
  style?: any;
}

const toMiles = (km: number) => (km * 0.621371).toFixed(1);

export default function TripMap({
  driverLocation,
  pickup,
  dropoff,
  routeCoords,
  stage,
  bottomPadding,
  style,
}: Props) {
  const { theme } = useTheme();
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const coords =
      routeCoords && routeCoords.length > 1
        ? routeCoords
        : [
            ...(driverLocation ? [driverLocation] : []),
            pickup,
            ...(dropoff && (stage === "offer" || stage === "to_dropoff")
              ? [dropoff]
              : []),
          ];

    if (coords.length > 0) {
      // Small delay still needed after onMapReady fires
      setTimeout(() => {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: {
            top: 120,
            right: 80,
            bottom: (bottomPadding ?? 80) + 80,
            left: 80,
          },
          animated: true,
        });
      }, 300);
    }
  }, [
    mapReady,
    driverLocation?.latitude,
    driverLocation?.longitude,
    pickup.latitude,
    dropoff?.latitude,
    stage,
    routeCoords?.length,
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

  return (
    <MapView
      ref={mapRef}
      onMapReady={() => setMapReady(true)}
      style={[styles.map, style]}
      provider={PROVIDER_GOOGLE}
      customMapStyle={theme === "dark" ? darkMapStyle : []}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsTraffic={false}
      showsBuildings={false}
      initialRegion={{
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
    >
      {/* Driver marker */}
      {driverLocation && (
        <Marker
          coordinate={driverLocation}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={3}
        >
          <View style={styles.driverDot}>
            <View style={styles.driverInner} />
          </View>
        </Marker>
      )}

      {/* Pickup marker */}
      <Marker coordinate={pickup} anchor={{ x: 0.5, y: 1 }} zIndex={2}>
        <View style={styles.pickupPin}>
          <View style={styles.pickupInner} />
        </View>
      </Marker>

      {/* Dropoff marker */}
      {dropoff && (stage === "offer" || stage === "to_dropoff") && (
        <Marker coordinate={dropoff} anchor={{ x: 0.5, y: 1 }} zIndex={2}>
          <View style={styles.dropoffPin}>
            <View style={styles.dropoffInner} />
          </View>
        </Marker>
      )}

      {/* Route polyline */}
      {routeCoords && routeCoords.length > 1 && (
        <Polyline
          coordinates={routeCoords}
          strokeColor="#f59e0b"
          strokeColors={["#f59e0b"]}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />
      )}

      {/* Straight line if no route coords (offer stage) */}
      {!routeCoords && dropoff && stage === "offer" && (
        <Polyline
          coordinates={[pickup, dropoff]}
          strokeColor="#f59e0b"
          strokeWidth={2}
          lineDashPattern={[8, 4]}
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  driverDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#3b82f6",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
  driverInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  pickupPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#22c55e",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#22c55e",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 8,
  },
  pickupInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  dropoffPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ef4444",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 8,
  },
  dropoffInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
});
