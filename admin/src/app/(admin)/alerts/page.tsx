'use client'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { format } from 'date-fns'
import { AlertTriangle, Clock, FileText, Car, CheckCircle } from 'lucide-react'
import { SectionHeader, Spinner } from '@/components/ui'

export default function AlertsPage() {
  const { data: expiring30, isLoading: l1 } = useQuery({
    queryKey: ['expiring', 30],
    queryFn: () => api.get('/admin/drivers/documents/expiring', { params: { days: 30 } }).then((r) => r.data.data),
  })

  const { data: expiring60 } = useQuery({
    queryKey: ['expiring', 60],
    queryFn: () => api.get('/admin/drivers/documents/expiring', { params: { days: 60 } }).then((r) => r.data.data),
  })

  const { data: pendingDocs } = useQuery({
    queryKey: ['docs', 'PENDING'],
    queryFn: () =>
      api.get('/admin/drivers', { params: { limit: 100 } }).then((r) =>
        r.data.data.flatMap((d: any) =>
          (d.documents ?? []).filter((doc: any) => doc.status === 'PENDING')
            .map((doc: any) => ({ ...doc, driver: d }))
        )
      ),
  })

  const daysUntil = (date: string) => Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)

  const critical = (expiring30 ?? []).filter((d: any) => daysUntil(d.expiryDate) <= 7)
  const warning  = (expiring30 ?? []).filter((d: any) => {
    const days = daysUntil(d.expiryDate)
    return days > 7 && days <= 30
  })
  const upcoming = (expiring60 ?? []).filter((d: any) => daysUntil(d.expiryDate) > 30)

  const totalAlerts = (critical?.length ?? 0) + (warning?.length ?? 0) + (pendingDocs?.length ?? 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Alerts & Compliance"
        subtitle={totalAlerts > 0 ? `${totalAlerts} items need attention` : 'All clear'}
      />

      {totalAlerts === 0 && !l1 && (
        <div className="card p-12 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center mb-3">
            <CheckCircle size={20} className="text-green-400" />
          </div>
          <p className="text-sm font-medium text-white">All clear</p>
          <p className="text-xs text-slate-500 mt-1">No documents expiring or pending review</p>
        </div>
      )}

      {/* Critical — expiring within 7 days */}
      {critical?.length > 0 && (
        <AlertSection
          icon={AlertTriangle}
          title="Critical — Expiring within 7 days"
          colour="red"
          items={critical}
          daysUntil={daysUntil}
        />
      )}

      {/* Pending review */}
      {pendingDocs?.length > 0 && (
        <div className="card border-yellow-500/20">
          <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
            <FileText size={14} className="text-yellow-400" />
            <p className="text-sm font-semibold text-white">Pending Document Review ({pendingDocs.length})</p>
          </div>
          <div className="divide-y divide-[#1e2d42]">
            {pendingDocs.map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs text-[var(--text)] font-medium">
                    {doc.driver?.user?.firstName} {doc.driver?.user?.lastName}
                  </p>
                  <p className="text-[10px] text-slate-500">{doc.type?.replace(/_/g, ' ')}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-600">Uploaded {doc.createdAt && format(new Date(doc.createdAt), 'dd MMM')}</p>
                  <a href="/documents" className="text-xs text-brand-400 hover:underline">Review →</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warning — 8–30 days */}
      {warning?.length > 0 && (
        <AlertSection
          icon={Clock}
          title="Warning — Expiring within 30 days"
          colour="yellow"
          items={warning}
          daysUntil={daysUntil}
        />
      )}

      {/* Upcoming — 31–60 days */}
      {upcoming?.length > 0 && (
        <AlertSection
          icon={Clock}
          title="Upcoming — Expiring within 60 days"
          colour="blue"
          items={upcoming}
          daysUntil={daysUntil}
        />
      )}
    </div>
  )
}

function AlertSection({ icon: Icon, title, colour, items, daysUntil }: any) {
  const colours: Record<string, string> = {
    red:    'text-red-400 border-red-500/20',
    yellow: 'text-yellow-400 border-yellow-500/20',
    blue:   'text-blue-400 border-blue-500/20',
  }
  const text = colours[colour].split(' ')[0]
  const border = colours[colour].split(' ')[1]

  return (
    <div className={`card ${border}`}>
      <div className="flex items-center gap-2 p-4 border-b border-[var(--border)]">
        <Icon size={14} className={text} />
        <p className="text-sm font-semibold text-white">{title} ({items.length})</p>
      </div>
      <div className="divide-y divide-[#1e2d42]">
        {items.map((doc: any) => {
          const days = daysUntil(doc.expiryDate)
          const driverUser = doc.driver?.user ?? doc.driver?.driver?.user
          return (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-[10px] font-bold">
                  {driverUser?.firstName?.[0]}{driverUser?.lastName?.[0]}
                </div>
                <div>
                  <p className="text-xs text-white">{driverUser?.firstName} {driverUser?.lastName}</p>
                  <p className="text-[10px] text-slate-500">{doc.type?.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-semibold ${text}`}>{days} days left</p>
                <p className="text-[10px] text-slate-600">{format(new Date(doc.expiryDate), 'dd MMM yyyy')}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
