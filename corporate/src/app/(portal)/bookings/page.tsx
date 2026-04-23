'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, X } from 'lucide-react'
import { Badge, Table, Pagination, EmptyState, Spinner, Modal } from '@/components/ui'
import { api } from '@/lib/api'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const STATUSES = ['All', 'PENDING', 'CONFIRMED', 'DRIVER_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

export default function BookingsPage() {
  const router = useRouter()
  const [bookings, setBookings] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('All')
  const [loading, setLoading] = useState(true)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const params: any = { page, limit: 20 }
      if (status !== 'All') params.status = status
      const { data } = await api.get('/corporate/bookings', { params })
      setBookings(data.data.items)
      setTotal(data.data.total)
    } catch {
      toast.error('Failed to load bookings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, status])

  const cancel = async () => {
    if (!cancelId) return
    setCancelling(true)
    try {
      await api.patch(`/corporate/bookings/${cancelId}/cancel`)
      toast.success('Booking cancelled')
      setCancelId(null)
      load()
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to cancel')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">{total} total bookings on your account</p>
        </div>
        <button onClick={() => router.push('/book')} className="btn-primary">+ New Booking</button>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {STATUSES.map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              status === s ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
            }`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={24} /></div>
        ) : (
          <>
            <Table
              headers={['Reference', 'Passenger', 'From → To', 'When', 'Fare', 'Status', '']}
              isEmpty={!bookings.length}
              emptyMessage="No bookings found"
            >
              {bookings.map(b => (
                <tr key={b.id} className="table-row cursor-pointer" onClick={() => router.push(`/bookings/${b.id}`)}>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-slate-500">{b.reference}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-800">{b.notes?.split('\n')[0] ?? '—'}</p>
                    {b.department && <p className="text-xs text-slate-400">{b.department}</p>}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <p className="text-xs text-slate-700 truncate">{b.pickupAddress}</p>
                    <p className="text-xs text-slate-400 truncate">→ {b.dropoffAddress}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="text-xs text-slate-700">
                      {b.scheduledAt ? format(new Date(b.scheduledAt), 'd MMM HH:mm') : 'ASAP'}
                    </p>
                    <p className="text-xs text-slate-400">{format(new Date(b.createdAt), 'd MMM yyyy')}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-slate-800">£{b.estimatedFare.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={b.status} />
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {['PENDING', 'CONFIRMED', 'DRIVER_ASSIGNED'].includes(b.status) && (
                      <button onClick={() => setCancelId(b.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={page} totalPages={Math.ceil(total / 20)} onChange={setPage} />
          </>
        )}
      </div>

      {/* Cancel modal */}
      <Modal open={!!cancelId} onClose={() => setCancelId(null)} title="Cancel Booking">
        <p className="text-sm text-slate-600 mb-5">Are you sure you want to cancel this booking? This cannot be undone.</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setCancelId(null)} className="btn-ghost">Keep Booking</button>
          <button onClick={cancel} disabled={cancelling} className="btn-danger flex items-center gap-2">
            {cancelling ? <Spinner size={14} /> : <X size={14} />}
            Cancel Booking
          </button>
        </div>
      </Modal>
    </div>
  )
}
