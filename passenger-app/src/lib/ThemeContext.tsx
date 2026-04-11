import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DarkColors, LightColors } from "./theme";

type ThemeType = "dark" | "light";
type ColorSet = typeof DarkColors;

interface ThemeContextValue {
  theme: ThemeType;
  Colors: ColorSet;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  Colors: DarkColors,
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeType>("light");

  useEffect(() => {
    AsyncStorage.getItem("passenger-theme").then((saved) => {
      if (saved === "light" || saved === "dark") setTheme(saved);
    });
  }, []);

  const toggle = async () => {
    const next: ThemeType = theme === "dark" ? "light" : "dark";
    setTheme(next);
    await AsyncStorage.setItem("passenger-theme", next);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        Colors: theme === "dark" ? DarkColors : LightColors,
        toggle,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
