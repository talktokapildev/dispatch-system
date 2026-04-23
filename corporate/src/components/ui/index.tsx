import { clsx } from 'clsx'
import { LucideIcon } from 'lucide-react'

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} className="animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ status, label, className }: { status?: string; label?: string; className?: string }) {
  return (
    <span className={clsx('badge', status && `status-${status}`, className)}>
      {label ?? status?.replace(/_/g, ' ')}
    </span>
  )
}

export function InvoiceBadge({ status }: { status: string }) {
  return <span className={clsx('badge', `invoice-${status}`)}>{status}</span>
}

// ─── Stat card ────────────────────────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, sub, accent = 'text-brand-500' }: {
  label: string; value: string | number; icon: LucideIcon; sub?: string; accent?: string
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className={clsx('text-2xl font-bold mt-1', accent)}>{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
          <Icon size={18} className={accent} />
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
        <Icon size={20} className="text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ headers, children, isEmpty, emptyMessage = 'No data' }: {
  headers: string[]; children: React.ReactNode; isEmpty?: boolean; emptyMessage?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            {headers.map(h => (
              <th key={h} className="text-left text-xs text-slate-500 font-semibold uppercase tracking-wide px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={headers.length} className="text-center py-12 text-slate-400 text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : children}
        </tbody>
      </table>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-slate-900 text-base">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none transition-colors">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <button onClick={() => onChange(page - 1)} disabled={page === 1} className="btn-ghost py-1 px-3 disabled:opacity-40 text-xs">Prev</button>
        <button onClick={() => onChange(page + 1)} disabled={page === totalPages} className="btn-ghost py-1 px-3 disabled:opacity-40 text-xs">Next</button>
      </div>
    </div>
  )
}
