'use client'
import { useEffect, useState } from 'react'
import { FileText, Download } from 'lucide-react'
import { InvoiceBadge, Table, EmptyState, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/corporate/invoices')
      .then(r => setInvoices(r.data.data))
      .catch(() => toast.error('Failed to load invoices'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Invoices</h1>
        <p className="page-subtitle">Monthly invoices for your account</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={24} /></div>
        ) : (
          <Table
            headers={['Invoice', 'Period', 'Bookings', 'Amount', 'Due Date', 'Status', '']}
            isEmpty={!invoices.length}
            emptyMessage="No invoices yet — they appear at the end of each month"
          >
            {invoices.map((inv: any) => (
              <tr key={inv.id} className="table-row">
                <td className="px-4 py-3">
                  <span className="text-sm font-mono font-medium text-slate-700">{inv.invoiceNumber}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {format(new Date(inv.periodFrom), 'd MMM')} – {format(new Date(inv.periodTo), 'd MMM yyyy')}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {inv._count?.bookings ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-bold text-slate-900">£{inv.totalAmount.toFixed(2)}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {format(new Date(inv.dueDate), 'd MMM yyyy')}
                </td>
                <td className="px-4 py-3">
                  <InvoiceBadge status={inv.status} />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toast('PDF download coming soon')}
                    className="flex items-center gap-1.5 text-xs text-brand-500 hover:text-brand-600 font-medium"
                  >
                    <Download size={12} /> PDF
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* Payment info */}
      <div className="mt-4 p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-700">
        <strong>Payment:</strong> Invoices are due within the agreed payment terms from issue date.
        To pay or query an invoice, contact <a href="mailto:admin@orangeride.co.uk" className="underline">admin@orangeride.co.uk</a>
      </div>
    </div>
  )
}
