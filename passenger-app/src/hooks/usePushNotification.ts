import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { api } from "../lib/api";

// Push notifications require a dev/production build — not supported in Expo Go since SDK 53
const IS_EXPO_GO = Constants.executionEnvironment === "storeClient";

export function usePushNotifications() {
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (IS_EXPO_GO) {
      console.log(
        "[Push] Skipping — requires a dev/production build, not Expo Go"
      );
      return;
    }

    // Only import and configure expo-notifications in real builds
    setupNotifications();

    async function setupNotifications() {
      const Notifications = await import("expo-notifications");

      // Configure foreground behaviour
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });

      // Handle tap on notification when app is backgrounded
      const sub = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const data = response.notification.request.content.data;
          console.log("[Push] Notification tapped:", data);
        }
      );

      await registerToken(Notifications);

      return () => sub.remove();
    }
  }, []);

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
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData.data;
      tokenRef.current = token;
      await api.post("/notifications/token", { token, platform: Platform.OS });
      console.log("[Push] Token registered:", token.slice(0, 30) + "…");
    } catch (err) {
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
