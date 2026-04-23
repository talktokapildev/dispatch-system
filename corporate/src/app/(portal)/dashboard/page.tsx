'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PoundSterling, BookOpen, Clock, PlusCircle, ArrowRight, CheckCircle } from 'lucide-react'
import { StatCard, Badge, Spinner, EmptyState } from '@/components/ui'
import { api, useAuthStore } from '@/lib/api'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface DashboardData {
  monthlySpend: number
  bookingsThisMonth: number
  upcomingCount: number
  recentBookings: any[]
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/corporate/dashboard')
      .then(r => setData(r.data.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-20"><Spinner size={28} /></div>

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Good {getGreeting()}, {user?.firstName} 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{user?.corporateAccount?.companyName}</p>
        </div>
        <Link href="/book">
          <button className="btn-primary flex items-center gap-2">
            <PlusCircle size={16} />
            Book a Car
          </button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Spend this month"
          value={`£${(data?.monthlySpend ?? 0).toFixed(2)}`}
          icon={PoundSterling}
          accent="text-brand-500"
        />
        <StatCard
          label="Bookings this month"
          value={data?.bookingsThisMonth ?? 0}
          icon={BookOpen}
          accent="text-blue-500"
        />
        <StatCard
          label="Upcoming bookings"
          value={data?.upcomingCount ?? 0}
          icon={Clock}
          accent="text-violet-500"
        />
      </div>

      {/* Credit */}
      {user?.corporateAccount && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Credit Account</h2>
            <span className="text-xs text-slate-400">{user.corporateAccount.paymentTermsDays}-day payment terms</span>
          </div>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-2xl font-bold text-slate-900">£{user.corporateAccount.currentBalance.toFixed(2)}</span>
            <span className="text-sm text-slate-400 mb-0.5">/ £{user.corporateAccount.creditLimit.toFixed(0)} limit</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (user.corporateAccount.currentBalance / user.corporateAccount.creditLimit) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">
            £{(user.corporateAccount.creditLimit - user.corporateAccount.currentBalance).toFixed(2)} available
          </p>
        </div>
      )}

      {/* Recent bookings */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Recent Bookings</h2>
          <Link href="/bookings" className="text-xs text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {!data?.recentBookings?.length ? (
          <EmptyState icon={BookOpen} title="No bookings yet" subtitle="Your bookings will appear here" />
        ) : (
          <div className="divide-y divide-slate-50">
            {data.recentBookings.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => router.push(`/bookings/${b.id}`)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-slate-400">{b.reference}</span>
                    <Badge status={b.status} />
                  </div>
                  <p className="text-sm font-medium text-slate-800 truncate">{b.pickupAddress}</p>
                  <p className="text-xs text-slate-400 truncate">→ {b.dropoffAddress}</p>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <p className="text-sm font-semibold text-slate-800">£{b.estimatedFare.toFixed(2)}</p>
                  <p className="text-xs text-slate-400">{format(new Date(b.createdAt), 'd MMM')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
