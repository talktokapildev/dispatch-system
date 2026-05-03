'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, X } from 'lucide-react'
import { api, Booking } from '@/lib/api'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Booking[]>('/carehome/bookings')
      .then(setBookings)
      .finally(() => setLoading(false))
  }, [])

  const cancel = async (id: string) => {
    if (!confirm('Cancel this booking?')) return
    try {
      await api.delete(`/carehome/bookings/${id}`)
      setBookings(b => b.filter(x => x.id !== id))
      toast.success('Booking cancelled')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const filtered = bookings.filter(b => {
    const s = search.toLowerCase()
    return (
      b.resident?.name.toLowerCase().includes(s) ||
      b.pickupAddress.toLowerCase().includes(s) ||
      b.dropoffAddress.toLowerCase().includes(s) ||
      b.reference.toLowerCase().includes(s)
    )
  })

  const canCancel = (status: string) => ['PENDING', 'CONFIRMED', 'DRIVER_ASSIGNED'].includes(status)

  return (
    <div>
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">{bookings.length} total bookings</p>
        </div>
        <Link href="/bookings/new" className="btn-primary self-start sm:self-auto">
          <Plus size={16} /> New Booking
        </Link>
      </div>

      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search by resident, address or reference…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="card p-12 text-center text-slate-400 text-sm">Loading bookings…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400 text-sm mb-4">No bookings found.</p>
          <Link href="/bookings/new" className="btn-primary inline-flex"><Plus size={16} /> New Booking</Link>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3">Resident</th>
                    <th className="px-5 py-3">Pickup</th>
                    <th className="px-5 py-3">Drop-off</th>
                    <th className="px-5 py-3">Date & Time</th>
                    <th className="px-5 py-3">Fare</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(b => (
                    <tr key={b.id} className="table-row">
                      <td className="px-5 py-3.5 font-medium text-slate-800">{b.resident?.name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-slate-600 max-w-[180px]">
                        <p className="truncate text-xs">{b.pickupAddress}</p>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 max-w-[180px]">
                        <p className="truncate text-xs">{b.dropoffAddress}</p>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap">
                        {b.scheduledAt ? format(new Date(b.scheduledAt), 'dd MMM, HH:mm') : '—'}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-slate-700">£{b.estimatedFare.toFixed(2)}</td>
                      <td className="px-5 py-3.5">
                        <span className={clsx('badge', `status-${b.status}`)}>{formatStatus(b.status)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {canCancel(b.status) && (
                          <button onClick={() => cancel(b.id)} className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map(b => (
              <div key={b.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-slate-800">{b.resident?.name ?? '—'}</span>
                      <span className={clsx('badge', `status-${b.status}`)}>{formatStatus(b.status)}</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate">{b.pickupAddress}</p>
                    <p className="text-xs text-slate-400 truncate">→ {b.dropoffAddress}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-slate-500">
                        {b.scheduledAt ? format(new Date(b.scheduledAt), 'dd MMM, HH:mm') : '—'}
                      </span>
                      <span className="text-sm font-bold text-slate-700">£{b.estimatedFare.toFixed(2)}</span>
                    </div>
                  </div>
                  {canCancel(b.status) && (
                    <button onClick={() => cancel(b.id)} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function formatStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
