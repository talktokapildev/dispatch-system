import axios from 'axios'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

export const api = axios.create({ baseURL: API_URL })

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('corp_token') : null
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('corp_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CorporateUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  corporateAccount: {
    id: string
    companyName: string
    contactName: string
    contactEmail: string
    creditLimit: number
    currentBalance: number
    paymentTermsDays: number
  }
}

interface AuthState {
  token: string | null
  user: CorporateUser | null
  _hasHydrated: boolean
  setHasHydrated: (v: boolean) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      login: async (email, password) => {
        const { data } = await api.post('/corporate/auth/login', { email, password })
        localStorage.setItem('corp_token', data.data.token)
        set({ token: data.data.token, user: data.data.user })
      },
      logout: () => {
        localStorage.removeItem('corp_token')
        set({ token: null, user: null })
        window.location.href = '/login'
      },
    }),
    {
      name: 'corp-auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => { state?.setHasHydrated(true) },
    }
  )
)
