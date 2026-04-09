'use client'
import { useQuery } from '@tanstack/react-query'
import { api, useAuthStore } from '@/lib/api'
import { useSocket } from '@/lib/socket'
import { StatCard, Badge } from '@/components/ui'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Car, BookOpen, PoundSterling, Users, AlertTriangle, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { useState } from 'react'

export default function DashboardPage() {
  const { token } = useAuthStore()
  const [liveStats, setLiveStats] = useState<any>(null)

  const { data, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/admin/dashboard').then((r) => r.data.data),
    refetchInterval: 30_000,
  })

  const { data: activeBookings } = useQuery({
    queryKey: ['active-bookings'],
    queryFn: () =>
      api.get('/admin/bookings', {
        params: { status: 'IN_PROGRESS,DRIVER_EN_ROUTE,DRIVER_ARRIVED,DRIVER_ASSIGNED', limit: 10 },
      }).then((r) => r.data.data),
    refetchInterval: 15_000,
  })

  useSocket(token, {
    'admin:booking_created': () => refetch(),
    'admin:booking_updated': () => refetch(),
  })

  const stats = data?.today
  const chart = data?.weeklyChart ?? []

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Control Centre</h1>
          <p className="text-sm text-slate-500 mt-0.5">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-400/10 px-3 py-1.5 rounded-full border border-green-400/20">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            System Live
          </span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Active Jobs"    value={stats?.activeJobs ?? 0}   icon={Car}           accent="text-brand-400" />
        <StatCard label="Online Drivers" value={stats?.onlineDrivers ?? 0} icon={Users}         accent="text-green-400" />
        <StatCard label="Bookings Today" value={stats?.totalBookings ?? 0} icon={BookOpen}      accent="text-blue-400" />
        <StatCard label="Completed"      value={stats?.completed ?? 0}     icon={BookOpen}      accent="text-green-400" />
        <StatCard label="Revenue Today"  value={`£${(stats?.revenue ?? 0).toFixed(2)}`} icon={PoundSterling} accent="text-brand-400" />
        <StatCard label="Cancelled"      value={stats?.cancelled ?? 0}     icon={AlertTriangle} accent="text-red-400" />
      </div>

      {/* Alerts */}
      {(data?.alerts?.pendingDocuments > 0 || data?.alerts?.expiringDocuments > 0) && (
        <div className="flex gap-3">
          {data.alerts.pendingDocuments > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
              <AlertTriangle size={14} />
              {data.alerts.pendingDocuments} documents pending review
            </div>
          )}
          {data.alerts.expiringDocuments > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <Clock size={14} />
              {data.alerts.expiringDocuments} documents expiring within 30 days
            </div>
          )}
        </div>
      )}

      {/* Chart + Active jobs */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Revenue chart */}
        <div className="card p-5 xl:col-span-2">
          <p className="text-sm font-semibold text-white mb-4">Revenue — Last 7 Days</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e2d42" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => format(new Date(v), 'dd MMM')} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
              <Tooltip
                contentStyle={{ background: '#0f1623', border: '1px solid #1e2d42', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => format(new Date(v), 'dd MMM yyyy')}
                formatter={(v: any) => [`£${Number(v).toFixed(2)}`, 'Revenue']}
              />
              <Area type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2} fill="url(#revGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Active jobs list */}
        <div className="card p-5">
          <p className="text-sm font-semibold text-white mb-4">Active Jobs</p>
          {!activeBookings?.items?.length ? (
            <p className="text-sm text-slate-500 text-center py-8">No active jobs</p>
          ) : (
            <div className="space-y-2">
              {activeBookings.items.slice(0, 6).map((b: any) => (
                <div key={b.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--card-hover)] border border-white/5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-brand-400">{b.reference}</span>
                      <Badge status={b.status} />
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{b.pickupAddress}</p>
                    <p className="text-xs text-slate-600 truncate">→ {b.dropoffAddress}</p>
                  </div>
                  <p className="text-xs text-brand-400 font-medium whitespace-nowrap">£{b.estimatedFare.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
