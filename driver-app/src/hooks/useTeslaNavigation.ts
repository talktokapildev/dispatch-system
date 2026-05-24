import { useCallback } from "react";
import { api } from "../lib/api";

export function useTeslaNavigation() {
  const sendToTesla = useCallback(
    async (lat: number, lon: number, label?: string) => {
      try {
        await api.post("/driver/tesla/navigate", { lat, lon, label });
      } catch (err) {
        // Silent — Tesla is a nice-to-have, never block job flow
        console.log("[Tesla] Navigate failed (non-fatal):", err);
      }
    },
    []
  );

  return { sendToTesla };
}
