import { create } from 'zustand'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://backend-production-baf2.up.railway.app/api/v1'

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('ch_token')
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error ?? 'Request failed')
  }
  return res.json()
}

export const api = {
  get:    <T>(path: string)              => req<T>('GET', path),
  post:   <T>(path: string, body: unknown) => req<T>('POST', path, body),
  put:    <T>(path: string, body: unknown) => req<T>('PUT', path, body),
  patch:  <T>(path: string, body?: unknown) => req<T>('PATCH', path, body),
  delete: <T>(path: string)              => req<T>('DELETE', path),
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CareHomeStaff {
  id: string
  name: string
  email: string
  phone?: string
  careHomeId: string
}

export interface CareHomeAccount {
  id: string
  name: string
  address: string
  contactName: string
  contactEmail: string
  contactPhone: string
  invoicingEmail: string
  paymentTermsDays: number
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'
}

export interface CareHomeResident {
  id: string
  careHomeId: string
  name: string
  dateOfBirth?: string
  mobility: 'AMBULATORY' | 'WALKING_AID' | 'WHEELCHAIR' | 'WHEELCHAIR_ASSIST' | 'STRETCHER'
  accessNotes?: string
  medicalNotes?: string
  contactName?: string
  contactPhone?: string
  isActive: boolean
  createdAt: string
}

export interface Booking {
  id: string
  reference: string
  residentId?: string
  resident?: CareHomeResident
  pickupAddress: string
  dropoffAddress: string
  scheduledAt?: string
  estimatedFare: number
  actualFare?: number
  status: string
  paymentMethod: string
  notes?: string
  driver?: {
    user: { firstName: string; lastName: string }
    vehicle?: { licensePlate: string; make: string; model: string }
  }
  createdAt: string
}

export interface RecurringBooking {
  id: string
  residentId: string
  resident?: CareHomeResident
  pickupAddress: string
  dropoffAddress: string
  pattern: 'DAILY' | 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY'
  dayOfWeek?: number
  dayOfMonth?: number
  scheduledTime: string
  distanceMiles?: number
  flatFare?: number
  notes?: string
  isActive: boolean
  createdAt: string
}

export interface CareHomeInvoice {
  id: string
  careHomeId: string
  periodFrom: string
  periodTo: string
  dueDate: string
  totalAmount: number
  isPaid: boolean
  paidAt?: string
  notes?: string
  bookings?: Booking[]
  createdAt: string
}

// ─── Auth store ───────────────────────────────────────────────────────────────

interface AuthState {
  staff: CareHomeStaff | null
  account: CareHomeAccount | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  loadFromStorage: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  staff: null,
  account: null,
  token: null,

  loadFromStorage: () => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('ch_token')
    const staff = localStorage.getItem('ch_staff')
    const account = localStorage.getItem('ch_account')
    if (token && staff && account) {
      set({ token, staff: JSON.parse(staff), account: JSON.parse(account) })
    }
  },

  login: async (email, password) => {
    const data = await api.post<{ token: string; staff: CareHomeStaff; account: CareHomeAccount }>(
      '/carehome/auth/login',
      { email, password }
    )
    localStorage.setItem('ch_token', data.token)
    localStorage.setItem('ch_staff', JSON.stringify(data.staff))
    localStorage.setItem('ch_account', JSON.stringify(data.account))
    set({ token: data.token, staff: data.staff, account: data.account })
  },

  logout: () => {
    localStorage.removeItem('ch_token')
    localStorage.removeItem('ch_staff')
    localStorage.removeItem('ch_account')
    set({ token: null, staff: null, account: null })
    window.location.href = '/login'
  },
}))
