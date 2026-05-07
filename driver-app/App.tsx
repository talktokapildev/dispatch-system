import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text, View, ActivityIndicator } from "react-native";
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
import { usePushNotifications } from "./src/hooks/usePushNotification";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { Colors } = useTheme();
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
  const { Colors } = useTheme();
  const [booting, setBooting] = useState(true);

  // Tracks whether the driver has accepted the background location disclosure.
  // null = not yet loaded from AsyncStorage (still booting)
  // true = accepted, go straight to Main
  // false = not accepted, show LocationDisclosureScreen first
  const [disclosureAccepted, setDisclosureAccepted] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    if (!_hasHydrated) return;

    const boot = async () => {
      // Load disclosure acceptance alongside auth check
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

  // Keep showing spinner until hydrated AND booted (including disclosure check)
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

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          // Not logged in — show login
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : !disclosureAccepted ? (
          // Logged in but disclosure not yet accepted — show full-screen disclosure.
          // This is the Google Play-compliant prominent disclosure: a dedicated
          // full-screen screen in the normal app flow, shown before HomeScreen.
          <Stack.Screen
            name="LocationDisclosure"
            component={LocationDisclosureScreen}
          />
        ) : (
          // Fully onboarded — show the main app
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="JobOffer"
              component={JobOfferScreen}
              options={{
                presentation: "card",
                gestureEnabled: false,
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen
              name="ActiveJob"
              component={ActiveJobScreen}
              options={{ gestureEnabled: false }}
            />
            <Stack.Screen name="JobComplete" component={JobCompleteScreen} />
            <Stack.Screen name="Documents" component={DocumentsScreen} />
            <Stack.Screen name="JobHistory" component={JobHistoryScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
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
