"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { createContext, useContext, useEffect, useState } from "react";

// ── Theme ──────────────────────────────────────────
type Theme = "dark" | "light";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to 'light' — matches the HTML class set by layout.tsx and the
  // inline script. This means the pre-hydration render uses the correct theme
  // and we avoid a dark flash even before localStorage is read.
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem("dispatch-theme") as Theme) ?? "light";
    setTheme(saved);
    document.documentElement.classList.toggle("dark", saved === "dark");
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("dispatch-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  // Don't hide children while mounting — the inline script in layout.tsx already
  // sets the correct html class before React runs, so there's no theme flicker.
  // Returning null here was the cause of the black screen flash.
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {/* Suppress hydration mismatch on the wrapper; theme class is set by the
          inline script before React hydrates so client/server will differ. */}
      <div suppressHydrationWarning style={{ display: "contents" }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

// ── Root providers ─────────────────────────────────
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
        <ToasterWithTheme />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function ToasterWithTheme() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: isDark ? "#0f1623" : "#ffffff",
          color: isDark ? "#e2e8f0" : "#0f172a",
          border: `1px solid ${isDark ? "#1e2d42" : "#e2e8f0"}`,
          fontSize: "13px",
        },
        success: {
          iconTheme: {
            primary: "#f59e0b",
            secondary: isDark ? "#0f1623" : "#ffffff",
          },
        },
      }}
    />
  );
}
