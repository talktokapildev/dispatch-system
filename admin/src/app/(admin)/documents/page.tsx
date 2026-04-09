'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import { format } from 'date-fns'
import { SectionHeader, Table, Badge, Modal, Spinner } from '@/components/ui'
import { CheckCircle, XCircle, Clock, AlertTriangle, FileText } from 'lucide-react'
import toast from 'react-hot-toast'

const DOC_TABS = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRING']

export default function DocumentsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('PENDING')
  const [selected, setSelected] = useState<any>(null)
  const [notes, setNotes] = useState('')

  const { data: pending, isLoading: loadingPending } = useQuery({
    queryKey: ['docs', 'PENDING'],
    queryFn: () => api.get('/admin/drivers', { params: { limit: 100 } }).then((r) =>
      r.data.data.flatMap((d: any) =>
        (d.documents ?? []).filter((doc: any) => doc.status === 'PENDING')
          .map((doc: any) => ({ ...doc, driver: d }))
      )
    ),
    refetchInterval: 30_000,
  })

  const { data: expiring, isLoading: loadingExpiring } = useQuery({
    queryKey: ['docs', 'EXPIRING'],
    queryFn: () => api.get('/admin/drivers/documents/expiring', { params: { days: 60 } }).then((r) => r.data.data),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ driverId, docId, status, notes }: any) =>
      api.patch(`/admin/drivers/${driverId}/documents/${docId}`, { status, notes }),
    onSuccess: () => {
      toast.success('Document reviewed')
      qc.invalidateQueries({ queryKey: ['docs'] })
      setSelected(null)
    },
    onError: () => toast.error('Review failed'),
  })

  const docs = tab === 'EXPIRING' ? (expiring ?? []) : (pending ?? [])
  const isLoading = tab === 'EXPIRING' ? loadingExpiring : loadingPending

  const daysUntilExpiry = (date: string) =>
    Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Document Management"
        subtitle="TfL compliance — PCO licences, insurance, MOT, DBS"
      />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[var(--table-hover)] rounded-lg border border-[var(--border)] w-fit">
        {DOC_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-all ${
              tab === t ? 'bg-brand-500 text-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t}
            {t === 'PENDING' && pending?.length > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1 py-0.5 rounded-full">{pending.length}</span>
            )}
            {t === 'EXPIRING' && expiring?.length > 0 && (
              <span className="ml-1.5 bg-yellow-500 text-black text-[10px] px-1 py-0.5 rounded-full">{expiring.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={24} /></div>
        ) : (
          <Table
            headers={
              tab === 'EXPIRING'
                ? ['Driver', 'Document', 'Expires', 'Days Left', 'Status']
                : ['Driver', 'Document', 'Uploaded', 'Expiry Date', 'Status', 'Action']
            }
            isEmpty={!docs.length}
            emptyMessage={`No ${tab.toLowerCase()} documents`}
          >
            {docs.map((doc: any) => {
              const driver = doc.driver ?? doc
              const driverUser = driver.user ?? driver.driver?.user
              const days = doc.expiryDate ? daysUntilExpiry(doc.expiryDate) : null

              return (
                <tr key={doc.id} className="table-row">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold">
                        {driverUser?.firstName?.[0]}{driverUser?.lastName?.[0]}
                      </div>
                      <div>
                        <p className="text-xs text-white">{driverUser?.firstName} {driverUser?.lastName}</p>
                        <p className="text-[10px] text-slate-500">{driver.pcoBadgeNumber ?? driver.driver?.pcoBadgeNumber}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <FileText size={12} className="text-slate-500" />
                      <span className="text-xs text-slate-300">{doc.type?.replace(/_/g, ' ')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {doc.createdAt ? format(new Date(doc.createdAt), 'dd MMM yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {doc.expiryDate ? (
                      <span className={days !== null && days <= 30 ? 'text-red-400' : days !== null && days <= 60 ? 'text-yellow-400' : 'text-slate-400'}>
                        {format(new Date(doc.expiryDate), 'dd MMM yyyy')}
                      </span>
                    ) : '—'}
                  </td>
                  {tab === 'EXPIRING' && (
                    <td className="px-4 py-3">
                      {days !== null && (
                        <span className={`text-xs font-semibold flex items-center gap-1 ${days <= 14 ? 'text-red-400' : days <= 30 ? 'text-orange-400' : 'text-yellow-400'}`}>
                          <AlertTriangle size={11} />
                          {days} days
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`badge text-[10px] ${
                      doc.status === 'PENDING'  ? 'bg-yellow-500/15 text-yellow-400' :
                      doc.status === 'APPROVED' ? 'bg-green-500/15 text-green-400' :
                      doc.status === 'REJECTED' ? 'bg-red-500/15 text-red-400' :
                      doc.status === 'EXPIRED'  ? 'bg-slate-500/15 text-slate-400' : ''
                    }`}>
                      {doc.status}
                    </span>
                  </td>
                  {tab === 'PENDING' && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelected(doc); setNotes('') }}
                        className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                      >
                        Review →
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </Table>
        )}
      </div>

      {/* Review modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Review Document">
        {selected && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  {selected.type?.replace(/_/g, ' ')}
                </p>
                <span className="text-xs text-slate-500">
                  Uploaded {selected.createdAt && format(new Date(selected.createdAt), 'dd MMM yyyy')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Driver: {selected.driver?.user?.firstName} {selected.driver?.user?.lastName} · {selected.driver?.pcoBadgeNumber}
              </p>
              {selected.expiryDate && (
                <p className="text-xs text-slate-400">
                  Document expires: <span className="text-white">{format(new Date(selected.expiryDate), 'dd MMM yyyy')}</span>
                </p>
              )}
              {selected.fileUrl && (
                <a
                  href={selected.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-400 hover:underline flex items-center gap-1 mt-2"
                >
                  <FileText size={11} /> View document file →
                </a>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Review notes (optional)</label>
              <textarea
                className="input resize-none h-20"
                placeholder="Any notes for the driver…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => reviewMutation.mutate({
                  driverId: selected.driver?.id ?? selected.driverId,
                  docId: selected.id,
                  status: 'APPROVED',
                  notes,
                })}
                disabled={reviewMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 text-sm font-medium transition-all"
              >
                <CheckCircle size={14} /> Approve
              </button>
              <button
                onClick={() => reviewMutation.mutate({
                  driverId: selected.driver?.id ?? selected.driverId,
                  docId: selected.id,
                  status: 'REJECTED',
                  notes,
                })}
                disabled={reviewMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm font-medium transition-all"
              >
                <XCircle size={14} /> Reject
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
