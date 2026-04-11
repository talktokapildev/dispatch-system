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

interface Passenger {
  id: string;
  userId: string;
  defaultPickupAddress?: string;
  defaultPickupLatitude?: number;
  defaultPickupLongitude?: number;
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
  passenger: Passenger | null;
  setAuth: (token: string, user: any, passenger: any) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      passenger: null,
      setAuth: (token, user, passenger) => set({ token, user, passenger }),
      logout: () => set({ token: null, user: null, passenger: null }),
    }),
    {
      name: "passenger-auth",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
