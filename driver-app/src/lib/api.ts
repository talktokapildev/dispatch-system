import axios from "axios";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_URL = "https://backend-production-baf2.up.railway.app/api/v1";
export const SOCKET_URL = "https://backend-production-baf2.up.railway.app";

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use(async (config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

interface Driver {
  id: string;
  userId: string;
  pcoBadgeNumber: string;
  status: string;
  rating: number;
  totalJobs: number;
  vehicle?: {
    make: string;
    model: string;
    licensePlate: string;
    class: string;
  };
}

interface AuthState {
  token: string | null;
  user: {
    id: string;
    phone: string;
    firstName: string;
    lastName: string;
    role: string;
  } | null;
  driver: Driver | null;
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  setAuth: (token: string, user: any, driver: any) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      driver: null,
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      setAuth: (token, user, driver) => set({ token, user, driver }),
      logout: () => set({ token: null, user: null, driver: null }),
    }),
    {
      name: "driver-auth",
      storage: createJSONStorage(() => AsyncStorage),
      // Exclude _hasHydrated from persistence so it always starts false
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        driver: state.driver,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
