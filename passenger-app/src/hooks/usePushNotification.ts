import { useEffect, useRef } from "react";
import { Platform, Alert } from "react-native";
import Constants from "expo-constants";
import { api, useAuthStore } from "../lib/api";

export function usePushNotifications() {
  const tokenRef = useRef<string | null>(null);
  const { token: authToken } = useAuthStore();

  useEffect(() => {
    // Don't attempt token registration until user is authenticated.
    // Without an auth token, POST /notifications/token returns 401 silently.
    if (!authToken) return;

    let sub: any;

    setupNotifications();

    async function setupNotifications() {
      const Notifications = await import("expo-notifications");

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });

      sub = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const data = response.notification.request.content.data;
          console.log("[Push] Notification tapped:", data);
        }
      );

      await registerToken(Notifications);
    }

    return () => sub?.remove();
  }, [authToken]); // ← re-run when auth token changes (login/logout)

  const registerToken = async (Notifications: any) => {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("[Push] Permission not granted");
      return;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#f59e0b",
        sound: "default",
      });
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      });
      const token = tokenData.data;
      tokenRef.current = token;
      await api.post("/notifications/token", { token, platform: Platform.OS });
      console.log("[Push] Token registered:", token.slice(0, 30) + "…");
    } catch (err: any) {
      Alert.alert("Push Token Error", err?.message ?? JSON.stringify(err));
      console.log("[Push] Could not get push token:", err);
    }
  };

  const unregisterToken = async () => {
    if (!tokenRef.current) return;
    try {
      await api.delete("/notifications/token", {
        data: { token: tokenRef.current },
      });
    } catch {}
    tokenRef.current = null;
  };

  return { unregisterToken };
}
