'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, CalendarDays, Repeat2, FileText, Plus, ArrowRight, Clock } from 'lucide-react'
import { api, useAuthStore, Booking, CareHomeResident, CareHomeInvoice } from '@/lib/api'
import { format } from 'date-fns'
import { clsx } from 'clsx'

export default function DashboardPage() {
  const { account } = useAuthStore()
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [invoices, setInvoices] = useState<CareHomeInvoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get<CareHomeResident[]>('/carehome/residents'),
      api.get<Booking[]>('/carehome/bookings'),
      api.get<CareHomeInvoice[]>('/carehome/invoices'),
    ]).then(([r, b, i]) => {
      setResidents(r)
      setBookings(b)
      setInvoices(i)
    }).finally(() => setLoading(false))
  }, [])

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const todayBookings = bookings.filter(b =>
    b.scheduledAt && format(new Date(b.scheduledAt), 'yyyy-MM-dd') === todayStr
  )
  const upcomingBookings = bookings.filter(b =>
    b.scheduledAt && new Date(b.scheduledAt) > today &&
    ['PENDING','CONFIRMED','DRIVER_ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED'].includes(b.status)
  )
  const unpaidInvoices = invoices.filter(i => !i.isPaid)

  const stats = [
    { label: 'Residents', value: residents.length, icon: Users, color: 'bg-brand-100 text-brand-600', href: '/residents' },
    { label: "Today's Rides", value: todayBookings.length, icon: Clock, color: 'bg-blue-100 text-blue-600', href: '/bookings' },
    { label: 'Upcoming', value: upcomingBookings.length, icon: CalendarDays, color: 'bg-violet-100 text-violet-600', href: '/bookings' },
    { label: 'Unpaid Invoices', value: unpaidInvoices.length, icon: FileText, color: 'bg-amber-100 text-amber-600', href: '/invoices' },
  ]

  const recentBookings = bookings.slice(0, 5)

  return (
    <div>
      {/* Header */}
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Good {getGreeting()}, {account?.name}</h1>
          <p className="page-subtitle">{format(today, 'EEEE, d MMMM yyyy')}</p>
        </div>
        <Link href="/bookings/new" className="btn-primary self-start sm:self-auto">
          <Plus size={16} /> New Booking
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(s => (
          <Link key={s.label} href={s.href} className="stat-card hover:shadow-md transition-shadow group">
            <div className={clsx('stat-icon', s.color)}>
              <s.icon size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {loading ? '—' : s.value}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick actions + recent bookings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent bookings */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-800">Recent Bookings</h2>
            <Link href="/bookings" className="text-xs text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
          ) : recentBookings.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No bookings yet</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentBookings.map(b => (
                <div key={b.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800 truncate">
                        {b.resident?.name ?? 'Unknown resident'}
                      </span>
                      <span className={clsx('badge', `status-${b.status}`)}>
                        {formatStatus(b.status)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{b.pickupAddress} → {b.dropoffAddress}</p>
                    {b.scheduledAt && (
                      <p className="text-xs text-slate-400 mt-0.5">{format(new Date(b.scheduledAt), 'dd MMM, HH:mm')}</p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-slate-700 shrink-0">£{b.estimatedFare.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link href="/bookings/new" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group">
                <div className="w-8 h-8 bg-brand-100 rounded-lg flex items-center justify-center group-hover:bg-brand-200 transition-colors">
                  <CalendarDays size={15} className="text-brand-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Book a ride</p>
                  <p className="text-xs text-slate-400">One-off transport</p>
                </div>
              </Link>
              <Link href="/residents/new" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group">
                <div className="w-8 h-8 bg-care-100 rounded-lg flex items-center justify-center group-hover:bg-care-200 transition-colors">
                  <Users size={15} className="text-care-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Add resident</p>
                  <p className="text-xs text-slate-400">Register new resident</p>
                </div>
              </Link>
              <Link href="/recurring" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group">
                <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                  <Repeat2 size={15} className="text-violet-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Set up recurring</p>
                  <p className="text-xs text-slate-400">Regular appointments</p>
                </div>
              </Link>
              <Link href="/invoices" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                  <FileText size={15} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">View invoices</p>
                  <p className="text-xs text-slate-400">{unpaidInvoices.length} outstanding</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function formatStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
