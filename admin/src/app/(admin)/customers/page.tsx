'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import { format } from 'date-fns'
import { Search, Trash2 } from 'lucide-react'
import { SectionHeader, Table, Modal, Spinner } from '@/components/ui'
import toast from 'react-hot-toast'

export default function CustomersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch]       = useState('')
  const [page, setPage]           = useState(1)
  const [selected, setSelected]   = useState<any>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['passengers', page, search],
    queryFn: () =>
      api.get('/admin/bookings', { params: { page, limit: 30 } }).then((r) => {
        const seen = new Set<string>()
        const passengers: any[] = []
        for (const b of r.data.data.items ?? []) {
          if (b.passenger && !seen.has(b.passenger.id)) {
            seen.add(b.passenger.id)
            passengers.push({ ...b.passenger, lastBooking: b.createdAt })
          }
        }
        return { passengers, total: r.data.data.total }
      }),
  })

  const deletePassenger = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/passengers/${id}`),
    onSuccess: () => {
      toast.success('Customer deleted')
      queryClient.invalidateQueries({ queryKey: ['passengers'] })
      setConfirmDelete(false)
      setSelected(null)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to delete customer')
      setConfirmDelete(false)
    },
  })

  const passengers = (data?.passengers ?? []).filter((p: any) =>
    !search ||
    `${p.user?.firstName} ${p.user?.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    p.user?.phone?.includes(search) ||
    p.user?.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader title="Customers" subtitle="All registered passengers" />

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input pl-9"
          placeholder="Search name, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={24} /></div>
        ) : (
          <Table
            headers={['Passenger', 'Phone', 'Email', 'Account Type', 'Last Booking', 'Total Rides', '']}
            isEmpty={!passengers.length}
            emptyMessage="No passengers found"
          >
            {passengers.map((p: any) => (
              <tr key={p.id} className="table-row">
                <td className="px-4 py-3 cursor-pointer" onClick={() => setSelected(p)}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">
                      {p.user?.firstName?.[0]}{p.user?.lastName?.[0]}
                    </div>
                    <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                      {p.user?.firstName || 'Unknown'} {p.user?.lastName}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs font-mono text-slate-400 cursor-pointer" onClick={() => setSelected(p)}>{p.user?.phone}</td>
                <td className="px-4 py-3 text-xs text-slate-500 cursor-pointer" onClick={() => setSelected(p)}>{p.user?.email ?? '—'}</td>
                <td className="px-4 py-3 cursor-pointer" onClick={() => setSelected(p)}>
                  {p.corporateAccountId
                    ? <span className="badge bg-violet-500/15 text-violet-400">Corporate</span>
                    : <span className="badge bg-slate-500/15 text-slate-400">Personal</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 cursor-pointer" onClick={() => setSelected(p)}>
                  {p.lastBooking ? format(new Date(p.lastBooking), 'dd MMM yyyy') : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 cursor-pointer" onClick={() => setSelected(p)}>{p.totalRides}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => { setSelected(p); setConfirmDelete(true) }}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="Delete customer"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* ── Passenger detail modal ── */}
      <Modal open={!!selected && !confirmDelete} onClose={() => setSelected(null)} title="Passenger Profile">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400 text-lg font-bold">
                {selected.user?.firstName?.[0]}{selected.user?.lastName?.[0]}
              </div>
              <div>
                <p className="font-semibold" style={{ color: 'var(--text)' }}>{selected.user?.firstName} {selected.user?.lastName}</p>
                <p className="text-sm text-slate-500">{selected.user?.phone}</p>
                {selected.user?.email && <p className="text-xs text-slate-600">{selected.user.email}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Account Type',    value: selected.corporateAccountId ? 'Corporate' : 'Personal' },
                { label: 'Total Rides',     value: selected.totalRides },
                { label: 'Stripe Customer', value: selected.stripeCustomerId ? '✓ Set up' : 'Not set up' },
                { label: 'Verified',        value: selected.user?.isVerified ? '✓ Yes' : '✗ No' },
              ].map(({ label, value }) => (
                <div key={label} className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                  <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                  <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>{String(value)}</p>
                </div>
              ))}
            </div>

            {selected.savedAddresses?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2">Saved Addresses</p>
                {selected.savedAddresses.map((addr: any, i: number) => (
                  <div key={i} className="text-xs text-slate-400 p-2 rounded bg-[var(--card-hover)] mb-1">
                    {addr.label}: {addr.address}
                  </div>
                ))}
              </div>
            )}

            {/* Delete button at bottom of detail modal */}
            <div className="pt-2 border-t border-[var(--border)]">
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={14} />
                Delete this customer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Confirm delete modal ── */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Customer">
        {selected && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400 font-medium mb-1">This action cannot be undone</p>
              <p className="text-xs text-slate-400">
                You are about to permanently delete <span className="text-white font-medium">{selected.user?.firstName} {selected.user?.lastName}</span> and all their data.
                Active bookings will prevent deletion.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 btn-ghost py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => deletePassenger.mutate(selected.id)}
                disabled={deletePassenger.isPending}
                className="flex-1 py-2.5 rounded-lg bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {deletePassenger.isPending ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}