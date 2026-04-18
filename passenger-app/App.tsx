import React, { useEffect } from "react";
import { Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { StripeProvider } from "@stripe/stripe-react-native";

import { ThemeProvider, useTheme } from "./src/lib/ThemeContext";
import { useAuthStore } from "./src/lib/api";
import { initSocket } from "./src/lib/socket";
import { usePushNotifications } from "./src/hooks/usePushNotification";

import LoginScreen from "./src/screens/LoginScreen";
import ProfileSetupScreen from "./src/screens/ProfileSetupScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BookingConfirmScreen from "./src/screens/BookingConfirmScreen";
//import StripePaymentScreen from "./src/screens/StripePaymentScreen";
import TrackingScreen from "./src/screens/TrackingScreen";
import RideCompleteScreen from "./src/screens/RideCompleteScreen";
import RideHistoryScreen from "./src/screens/RideHistoryScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

const STRIPE_PUBLISHABLE_KEY =
  "pk_live_51TJsFkJUpxtjNsXGo8c8VR7eZwVxOZoWHu0dgqTymXBE2URyyt4arseGyd2mzgacY2WcnbHQ5CY3rkIdiWWUrDdj00ZFBQGDnD";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function EmojiIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{emoji}</Text>
  );
}

function MainTabs() {
  const { Colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 58,
        },
        tabBarActiveTintColor: Colors.brand,
        tabBarInactiveTintColor: Colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: "Book",
          tabBarIcon: ({ focused }) => (
            <EmojiIcon emoji="🚕" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={RideHistoryScreen}
        options={{
          tabBarLabel: "Rides",
          tabBarIcon: ({ focused }) => (
            <EmojiIcon emoji="📋" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ focused }) => (
            <EmojiIcon emoji="👤" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { theme } = useTheme();
  const { token, user } = useAuthStore();

  usePushNotifications();

  useEffect(() => {
    if (token) initSocket(token);
  }, [token]);

  const needsProfileSetup =
    token && (!user?.firstName || user.firstName.trim() === "");

  return (
    <NavigationContainer>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: "slide_from_right" }}
      >
        {!token ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : needsProfileSetup ? (
          <Stack.Screen
            name="ProfileSetup"
            component={ProfileSetupScreen}
            options={{ animation: "fade" }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Main"
              component={MainTabs}
              options={{ animation: "none" }}
            />
            <Stack.Screen
              name="BookingConfirm"
              component={BookingConfirmScreen}
            />
            {/* <Stack.Screen
              name="StripePayment"
              component={StripePaymentScreen}
              options={{ presentation: "modal", gestureEnabled: false }}
            /> */}
            <Stack.Screen
              name="Tracking"
              component={TrackingScreen}
              options={{
                presentation: "fullScreenModal",
                gestureEnabled: false,
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen
              name="RideComplete"
              component={RideCompleteScreen}
              options={{
                presentation: "fullScreenModal",
                gestureEnabled: false,
                animation: "fade",
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <StripeProvider
            publishableKey={STRIPE_PUBLISHABLE_KEY}
            merchantIdentifier="merchant.com.orangeride.passenger"
          >
            <RootNavigator />
          </StripeProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
