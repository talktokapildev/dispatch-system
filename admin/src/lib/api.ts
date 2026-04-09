import axios from "axios";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("admin_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ─── Auth store ───
interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      login: async (email, password) => {
        const { data } = await api.post("/auth/admin/login", {
          email,
          password,
        });
        localStorage.setItem("admin_token", data.data.token);
        set({ token: data.data.token, user: data.data.user });
      },
      logout: () => {
        localStorage.removeItem("admin_token");
        set({ token: null, user: null });
      },
    }),
    {
      name: "dispatch-auth",
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => {
        // Called once localStorage has been read and state restored.
        // Safe to check token from here onwards.
        state?.setHasHydrated(true);
      },
    }
  )
);
