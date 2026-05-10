// passenger-app/src/lib/operatorSettings.ts
// Fetches public operator settings from GET /settings on app boot.
// Persisted to AsyncStorage so the last known values work offline.
// Falls back to hardcoded defaults if the fetch fails.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

interface OperatorSettings {
  contactPhone: string;
  contactEmail: string;
  companyName: string;
  licenceNumber: string;
  businessAddress: string;
}

interface OperatorSettingsStore {
  settings: OperatorSettings;
  fetchSettings: () => Promise<void>;
}

// Hardcoded defaults — used on first install before the fetch completes,
// and as fallback if the backend is unreachable.
const DEFAULTS: OperatorSettings = {
  contactPhone: "+447398341839",
  contactEmail: "admin@orangeride.co.uk",
  companyName: "OrangeRide",
  licenceNumber: "II786",
  businessAddress: "Regus, One Elmfield Park, Bromley, BR1 1LU",
};

export const useOperatorSettings = create<OperatorSettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULTS,
      fetchSettings: async () => {
        try {
          const { data } = await api.get("/settings");
          if (data.success && data.data) {
            set({ settings: { ...DEFAULTS, ...data.data } });
          }
        } catch {
          // Silently fail — defaults or last persisted values will be used
        }
      },
    }),
    {
      name: "operator-settings",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the settings object, not the fetch function
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
