import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useTheme } from "../lib/ThemeContext";
import { FontSize, Spacing, Radius } from "../lib/theme";
import { api } from "../lib/api";

interface TeslaVehicle {
  id_s: string;
  display_name: string;
  vin: string;
  state: string;
}

interface TeslaStatus {
  connected: boolean;
  integration?: {
    enabled: boolean;
    vehicleId: string;
    vehicleName: string | null;
  };
}

export default function TeslaSettingsScreen({ navigation }: any) {
  const { Colors } = useTheme();
  const [status, setStatus] = useState<TeslaStatus | null>(null);
  const [vehicles, setVehicles] = useState<TeslaVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get("/driver/tesla/status");
      setStatus(res.data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await api.get("/driver/tesla/vehicles");
      setVehicles(res.data.vehicles ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.connected) fetchVehicles();
  }, [status?.connected, fetchVehicles]);

  // Listen for deep link return from Tesla OAuth
  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      if (!url.includes("tesla-callback")) return;
      const params = new URL(url).searchParams;
      const success = params.get("success") === "true";
      const error = params.get("error") ?? undefined;

      setConnecting(false);

      if (success) {
        fetchStatus();
        Alert.alert("Connected! 🎉", "Your Tesla is now linked to OrangeRide.");
      } else {
        Alert.alert(
          "Connection failed",
          error === "access_denied"
            ? "You cancelled the Tesla login."
            : "Failed to connect Tesla. Please try again."
        );
      }
    };

    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, [fetchStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await api.get("/driver/tesla/auth-url");
      await Linking.openURL(res.data.url);
    } catch {
      setConnecting(false);
      Alert.alert(
        "Error",
        "Could not start Tesla connection. Please try again."
      );
    }
  };

  const handleToggle = async (value: boolean) => {
    setToggling(true);
    try {
      await api.patch("/driver/tesla/settings", { enabled: value });
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              integration: prev.integration
                ? { ...prev.integration, enabled: value }
                : undefined,
            }
          : prev
      );
    } catch {
      Alert.alert("Error", "Failed to update Tesla settings.");
    } finally {
      setToggling(false);
    }
  };

  const handleSelectVehicle = async (vehicle: TeslaVehicle) => {
    try {
      await api.patch("/driver/tesla/settings", {
        vehicleId: vehicle.id_s,
        vehicleName: vehicle.display_name,
      });
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              integration: prev.integration
                ? {
                    ...prev.integration,
                    vehicleId: vehicle.id_s,
                    vehicleName: vehicle.display_name,
                  }
                : undefined,
            }
          : prev
      );
      Alert.alert(
        "Vehicle updated",
        `Routes will now go to ${vehicle.display_name}.`
      );
    } catch {
      Alert.alert("Error", "Failed to select vehicle.");
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Tesla",
      "Are you sure? You can reconnect anytime.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete("/driver/tesla/disconnect");
              setStatus({ connected: false });
              setVehicles([]);
            } catch {
              Alert.alert("Error", "Failed to disconnect.");
            }
          },
        },
      ]
    );
  };

  const s = styles(Colors);

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={Colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>🚗</Text>
        <Text style={s.title}>Tesla Integration</Text>
        <Text style={s.subtitle}>
          Automatically send job routes to your Tesla screen when you accept a
          booking.
        </Text>
      </View>

      {!status?.connected ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Not Connected</Text>
          <Text style={s.cardText}>
            Sign in with your Tesla account to enable automatic navigation.
          </Text>
          <TouchableOpacity
            style={[s.connectBtn, connecting && s.btnDisabled]}
            onPress={handleConnect}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={s.connectBtnText}>🔗 Connect Tesla Account</Text>
            )}
          </TouchableOpacity>
          {connecting && (
            <Text style={s.connectingHint}>
              Complete sign-in in your browser — you'll be brought back here
              automatically.
            </Text>
          )}
        </View>
      ) : (
        <>
          {/* Toggle */}
          <View style={s.card}>
            <View style={s.row}>
              <View style={{ flex: 1, marginRight: Spacing.md }}>
                <Text style={s.cardTitle}>Send Routes to Tesla</Text>
                <Text style={s.cardText}>
                  Pickup sent on accept. Dropoff sent when trip starts.
                </Text>
              </View>
              <Switch
                value={status.integration?.enabled ?? false}
                onValueChange={handleToggle}
                disabled={toggling}
                trackColor={{ true: Colors.brand, false: Colors.border }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Vehicle selector */}
          {vehicles.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>
                {vehicles.length === 1 ? "Your Vehicle" : "Select Vehicle"}
              </Text>
              {vehicles.map((v) => {
                const selected = status.integration?.vehicleId === v.id_s;
                return (
                  <TouchableOpacity
                    key={v.id_s}
                    style={[s.vehicleRow, selected && s.vehicleRowSelected]}
                    onPress={() => handleSelectVehicle(v)}
                  >
                    <Text style={s.vehicleIcon}>🚘</Text>
                    <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                      <Text
                        style={[
                          s.vehicleName,
                          selected && { color: Colors.brand },
                        ]}
                      >
                        {v.display_name}
                      </Text>
                      <Text style={s.vehicleVin}>{v.vin}</Text>
                    </View>
                    {selected && <Text style={{ color: Colors.brand }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* How it works */}
          <View style={s.card}>
            <Text style={s.cardTitle}>How It Works</Text>
            {[
              {
                icon: "✅",
                text: "Accept a job → pickup address sent to your Tesla",
              },
              {
                icon: "🗺️",
                text: "Passenger picked up → dropoff sent to your Tesla",
              },
              {
                icon: "⚡",
                text: "Tesla wakes from sleep automatically if needed",
              },
              {
                icon: "🔕",
                text: "Toggle off above if you're not driving your Tesla today",
              },
            ].map((item, i) => (
              <View key={i} style={s.infoRow}>
                <Text style={s.infoIcon}>{item.icon}</Text>
                <Text style={s.infoText}>{item.text}</Text>
              </View>
            ))}
          </View>

          {/* Disconnect */}
          <TouchableOpacity style={s.disconnectBtn} onPress={handleDisconnect}>
            <Text style={s.disconnectText}>Disconnect Tesla Account</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = (
  C: ReturnType<typeof import("../lib/ThemeContext").useTheme>["Colors"]
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    content: { padding: Spacing.lg, paddingBottom: 40 },
    centered: { flex: 1, justifyContent: "center", alignItems: "center" },
    header: { alignItems: "center", marginBottom: Spacing.xl },
    headerIcon: { fontSize: 48 },
    title: {
      fontSize: FontSize.xl,
      fontWeight: "700",
      color: C.text,
      marginTop: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: C.muted,
      textAlign: "center",
      marginTop: Spacing.sm,
      lineHeight: 20,
    },
    card: {
      backgroundColor: C.card,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    cardTitle: {
      fontSize: FontSize.md,
      fontWeight: "600",
      color: C.text,
      marginBottom: Spacing.xs,
    },
    cardText: { fontSize: FontSize.sm, color: C.muted, lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center" },
    connectBtn: {
      backgroundColor: C.brand,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.md,
    },
    connectBtnText: { color: "#000", fontWeight: "700", fontSize: FontSize.md },
    btnDisabled: { opacity: 0.5 },
    connectingHint: {
      fontSize: FontSize.xs,
      color: C.muted,
      textAlign: "center",
      marginTop: Spacing.sm,
      lineHeight: 18,
    },
    vehicleRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.sm,
      marginTop: Spacing.sm,
      backgroundColor: C.bg,
    },
    vehicleRowSelected: { backgroundColor: C.brand + "18" },
    vehicleIcon: { fontSize: 20 },
    vehicleName: {
      fontSize: FontSize.md,
      fontWeight: "600",
      color: C.text,
    },
    vehicleVin: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: Spacing.sm,
    },
    infoIcon: { fontSize: 16, marginRight: Spacing.sm },
    infoText: {
      flex: 1,
      fontSize: FontSize.sm,
      color: C.muted,
      lineHeight: 20,
    },
    disconnectBtn: {
      borderWidth: 1,
      borderColor: C.danger,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      alignItems: "center",
      marginTop: Spacing.xs,
    },
    disconnectText: {
      color: C.danger,
      fontWeight: "600",
      fontSize: FontSize.md,
    },
  });
