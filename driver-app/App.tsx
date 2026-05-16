import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text, View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuthStore, api } from "./src/lib/api";
import { initSocket } from "./src/lib/socket";
import { ThemeProvider, useTheme } from "./src/lib/ThemeContext";

import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import EarningsScreen from "./src/screens/EarningsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import JobOfferScreen from "./src/screens/JobOfferScreen";
import ActiveJobScreen from "./src/screens/ActiveJobScreen";
import JobCompleteScreen from "./src/screens/JobCompleteScreen";
import DocumentsScreen from "./src/screens/DocumentsScreen";
import JobHistoryScreen from "./src/screens/JobHistoryScreen";
import LocationDisclosureScreen, {
  DISCLOSURE_ACCEPTED_KEY,
} from "./src/screens/LocationDisclosureScreen";
import DriverApplicationScreen from "./src/screens/DriverApplicationScreen";
import DocumentUploadScreen from "./src/screens/DocumentUploadScreen";
import ApplicationPendingScreen from "./src/screens/ApplicationPendingScreen";
import { usePushNotifications } from "./src/hooks/usePushNotification";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { Colors, theme } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.brand,
        tabBarInactiveTintColor: Colors.muted,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: () => <Text>🏠</Text>, tabBarLabel: "Home" }}
      />
      <Tab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{ tabBarIcon: () => <Text>💷</Text>, tabBarLabel: "Earnings" }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: () => <Text>👤</Text>, tabBarLabel: "Profile" }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { token, _hasHydrated, setAuth, logout } = useAuthStore();
  usePushNotifications();
  const { Colors, theme } = useTheme();
  const [booting, setBooting] = useState(true);
  const [disclosureAccepted, setDisclosureAccepted] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    if (!_hasHydrated) return;

    const boot = async () => {
      const [, disclosureVal] = await Promise.all([
        (async () => {
          if (token) {
            try {
              const { data } = await api.get("/auth/me");
              setAuth(token, data.data, data.data.driver);
              initSocket(token);
            } catch (e) {
              logout();
            }
          }
        })(),
        AsyncStorage.getItem(DISCLOSURE_ACCEPTED_KEY),
      ]);

      setDisclosureAccepted(disclosureVal === "true");
      setBooting(false);
    };

    boot();
  }, [_hasHydrated]);

  if (!_hasHydrated || booting || disclosureAccepted === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🚖</Text>
        <ActivityIndicator color={Colors.brand} size="large" />
      </View>
    );
  }

  const navTheme = {
    dark: theme === "dark",
    colors: {
      primary: Colors.brand,
      background: Colors.bg,
      card: Colors.card,
      text: Colors.text,
      border: Colors.border,
      notification: Colors.brand,
    },
    fonts: {
      regular: { fontFamily: "System", fontWeight: "400" },
      medium: { fontFamily: "System", fontWeight: "500" },
      bold: { fontFamily: "System", fontWeight: "700" },
      heavy: { fontFamily: "System", fontWeight: "900" },
    },
  } as const;

  return (
    // Root View sets background behind the iOS status bar.
    // On iOS, StatusBar backgroundColor prop is ignored — the status bar
    // shows whatever native view is rendered behind it. This View ensures
    // that area is always Colors.bg instead of black.
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            headerBackVisible: false,
            headerBackTitle: "",
            contentStyle: { backgroundColor: Colors.bg },
          }}
        >
          {!token ? (
            // ── Pre-auth screens ──
            // Login is the initial screen. DriverApplication, DocumentUpload, and
            // ApplicationPending are navigable from LoginScreen without a token.
            <>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen
                name="DriverApplication"
                component={DriverApplicationScreen}
                options={{ animation: "slide_from_right" }}
              />
              <Stack.Screen
                name="DocumentUpload"
                component={DocumentUploadScreen}
                options={{
                  animation: "slide_from_right",
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen
                name="ApplicationPending"
                component={ApplicationPendingScreen}
                options={{
                  animation: "slide_from_right",
                  gestureEnabled: false,
                }}
              />
            </>
          ) : !disclosureAccepted ? (
            // ── Background location disclosure ──
            <Stack.Screen
              name="LocationDisclosure"
              component={LocationDisclosureScreen}
              initialParams={{ onAccepted: () => setDisclosureAccepted(true) }}
            />
          ) : (
            // ── Main authenticated app ──
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen
                name="JobOffer"
                component={JobOfferScreen}
                options={{
                  // fullScreenModal uses UIModalPresentationStyle.fullScreen —
                  // separate UIViewController with no UINavigationBar context,
                  // so no back-button artifact. Different from "modal" (sheet style)
                  // which broke Google Maps camera init (v1.0.10 fix still holds).
                  presentation: "fullScreenModal",
                  gestureEnabled: false,
                  animation: "slide_from_bottom",
                }}
              />
              <Stack.Screen
                name="ActiveJob"
                component={ActiveJobScreen}
                options={{ gestureEnabled: false }}
              />
              <Stack.Screen
                name="JobComplete"
                component={JobCompleteScreen}
                options={{}}
              />
              <Stack.Screen
                name="Documents"
                component={DocumentsScreen}
                options={{}}
              />
              <Stack.Screen
                name="JobHistory"
                component={JobHistoryScreen}
                options={{}}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
