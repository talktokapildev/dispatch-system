'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, ChevronRight, CheckCircle, Clock } from 'lucide-react'
import { api, CareHomeInvoice } from '@/lib/api'
import { format } from 'date-fns'
import { clsx } from 'clsx'

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<CareHomeInvoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<CareHomeInvoice[]>('/carehome/invoices')
      .then(setInvoices)
      .finally(() => setLoading(false))
  }, [])

  const outstanding = invoices.filter(i => !i.isPaid)
  const totalOutstanding = outstanding.reduce((s, i) => s + i.totalAmount, 0)

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Invoices</h1>
        <p className="page-subtitle">Monthly billing summaries</p>
      </div>

      {/* Outstanding summary */}
      {outstanding.length > 0 && (
        <div className="card p-5 mb-6 border-amber-200 bg-amber-50 flex items-center gap-4">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
            <Clock size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-amber-800">
              {outstanding.length} outstanding invoice{outstanding.length > 1 ? 's' : ''} — £{totalOutstanding.toFixed(2)} total
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Please arrange payment with your OrangeRide account manager.</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-slate-400 text-sm">Loading invoices…</div>
      ) : invoices.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No invoices yet. Invoices are generated monthly by OrangeRide.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3">Period</th>
                    <th className="px-5 py-3">Rides</th>
                    <th className="px-5 py-3">Total</th>
                    <th className="px-5 py-3">Due Date</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} className="table-row">
                      <td className="px-5 py-3.5 font-medium text-slate-800">
                        {format(new Date(inv.periodFrom), 'dd MMM')} – {format(new Date(inv.periodTo), 'dd MMM yyyy')}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {inv.bookings?.length ?? '—'}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">£{inv.totalAmount.toFixed(2)}</td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {format(new Date(inv.dueDate), 'dd MMM yyyy')}
                      </td>
                      <td className="px-5 py-3.5">
                        {inv.isPaid ? (
                          <span className="badge bg-green-100 text-green-700 flex items-center gap-1 w-fit">
                            <CheckCircle size={11} /> Paid
                          </span>
                        ) : (
                          <span className="badge bg-amber-100 text-amber-700">Outstanding</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <Link href={`/invoices/${inv.id}`} className="text-slate-400 hover:text-brand-500 transition-colors">
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {invoices.map(inv => (
              <Link key={inv.id} href={`/invoices/${inv.id}`} className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                  inv.isPaid ? 'bg-green-100' : 'bg-amber-100')}>
                  <FileText size={16} className={inv.isPaid ? 'text-green-600' : 'text-amber-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {format(new Date(inv.periodFrom), 'dd MMM')} – {format(new Date(inv.periodTo), 'dd MMM yyyy')}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Due {format(new Date(inv.dueDate), 'dd MMM yyyy')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-800">£{inv.totalAmount.toFixed(2)}</p>
                  <span className={clsx('badge mt-1', inv.isPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                    {inv.isPaid ? 'Paid' : 'Outstanding'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
