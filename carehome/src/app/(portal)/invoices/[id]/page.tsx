'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, Clock, Download } from 'lucide-react'
import { api, CareHomeInvoice } from '@/lib/api'
import { format } from 'date-fns'
import { clsx } from 'clsx'

export default function InvoiceDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [invoice, setInvoice] = useState<CareHomeInvoice | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<CareHomeInvoice>(`/carehome/invoices/${id}`)
      .then(setInvoice)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="card p-12 text-center text-slate-400 text-sm">Loading…</div>
  if (!invoice) return <div className="card p-12 text-center text-slate-400 text-sm">Invoice not found</div>

  return (
    <div>
      <div className="page-header">
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft size={15} /> Back to Invoices
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="page-title">Invoice</h1>
          {invoice.isPaid ? (
            <span className="badge bg-green-100 text-green-700 flex items-center gap-1">
              <CheckCircle size={11} /> Paid {invoice.paidAt ? format(new Date(invoice.paidAt), 'dd MMM yyyy') : ''}
            </span>
          ) : (
            <span className="badge bg-amber-100 text-amber-700 flex items-center gap-1">
              <Clock size={11} /> Outstanding
            </span>
          )}
        </div>
      </div>

      <div className="max-w-2xl space-y-5">
        {/* Invoice summary */}
        <div className="card p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-1">Period</p>
              <p className="font-semibold text-slate-800">
                {format(new Date(invoice.periodFrom), 'dd MMM')} – {format(new Date(invoice.periodTo), 'dd MMM yyyy')}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Due Date</p>
              <p className="font-semibold text-slate-800">{format(new Date(invoice.dueDate), 'dd MMM yyyy')}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Rides</p>
              <p className="font-semibold text-slate-800">{invoice.bookings?.length ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Total</p>
              <p className="text-xl font-bold text-slate-900">£{invoice.totalAmount.toFixed(2)}</p>
            </div>
          </div>
          {invoice.notes && (
            <p className="mt-4 text-sm text-slate-500 border-t border-slate-100 pt-4">{invoice.notes}</p>
          )}
        </div>

        {/* Booking breakdown */}
        {invoice.bookings && invoice.bookings.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-700">Ride Breakdown</h2>
            </div>
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 border-b border-slate-100">
                    <th className="px-5 py-3">Resident</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Route</th>
                    <th className="px-5 py-3 text-right">Fare</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.bookings.map(b => (
                    <tr key={b.id} className="table-row">
                      <td className="px-5 py-3 font-medium text-slate-800">{b.resident?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-600 whitespace-nowrap">
                        {b.scheduledAt ? format(new Date(b.scheduledAt), 'dd MMM') : '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs max-w-[200px]">
                        <p className="truncate">{b.pickupAddress}</p>
                        <p className="truncate text-slate-400">→ {b.dropoffAddress}</p>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-700">
                        £{(b.actualFare ?? b.estimatedFare).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={3} className="px-5 py-3 text-sm font-bold text-slate-700 text-right">Total</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-900">£{invoice.totalAmount.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {!invoice.isPaid && (
          <div className="card p-5 border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800 font-medium">Payment outstanding</p>
            <p className="text-xs text-amber-600 mt-1">
              Please arrange payment with your OrangeRide account manager before {format(new Date(invoice.dueDate), 'dd MMMM yyyy')}.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
