'use client'
import { useEffect, useState } from 'react'
import { Plus, Repeat2, Pencil, ToggleLeft, ToggleRight } from 'lucide-react'
import { api, CareHomeResident, RecurringBooking } from '@/lib/api'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PATTERNS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'FORTNIGHTLY', label: 'Fortnightly' },
  { value: 'MONTHLY', label: 'Monthly' },
]

export default function RecurringPage() {
  const [recurring, setRecurring] = useState<RecurringBooking[]>([])
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    residentId: '', pickupAddress: '', dropoffAddress: '',
    pattern: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1,
    scheduledTime: '09:00', flatFare: '', notes: '',
  })

  const load = () => {
    Promise.all([
      api.get<RecurringBooking[]>('/carehome/recurring'),
      api.get<CareHomeResident[]>('/carehome/residents'),
    ]).then(([r, res]) => { setRecurring(r); setResidents(res) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/carehome/recurring', {
        residentId: form.residentId,
        pickupAddress: form.pickupAddress,
        dropoffAddress: form.dropoffAddress,
        pattern: form.pattern,
        dayOfWeek: ['WEEKLY', 'FORTNIGHTLY'].includes(form.pattern) ? Number(form.dayOfWeek) : undefined,
        dayOfMonth: form.pattern === 'MONTHLY' ? Number(form.dayOfMonth) : undefined,
        scheduledTime: form.scheduledTime,
        flatFare: form.flatFare ? Number(form.flatFare) : undefined,
        notes: form.notes || undefined,
      })
      toast.success('Recurring booking created')
      setShowForm(false)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/carehome/recurring/${id}`, { isActive: !isActive })
      setRecurring(r => r.map(x => x.id === id ? { ...x, isActive: !isActive } : x))
      toast.success(isActive ? 'Paused' : 'Resumed')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const describePattern = (r: RecurringBooking) => {
    if (r.pattern === 'DAILY') return 'Every day'
    if (r.pattern === 'WEEKLY') return `Every ${DAYS[r.dayOfWeek ?? 1]}`
    if (r.pattern === 'FORTNIGHTLY') return `Every other ${DAYS[r.dayOfWeek ?? 1]}`
    if (r.pattern === 'MONTHLY') return `Monthly on day ${r.dayOfMonth}`
    return r.pattern
  }

  return (
    <div>
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Recurring Bookings</h1>
          <p className="page-subtitle">Scheduled regular transport for residents</p>
        </div>
        <button className="btn-primary self-start sm:self-auto" onClick={() => setShowForm(s => !s)}>
          <Plus size={16} /> New Schedule
        </button>
      </div>

      {/* New recurring form */}
      {showForm && (
        <div className="card p-6 mb-6 max-w-xl animate-slide-up">
          <h2 className="text-sm font-bold text-slate-800 mb-4">New Recurring Schedule</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Resident *</label>
              <select className="input" value={form.residentId} onChange={e => set('residentId', e.target.value)} required>
                <option value="">Select resident…</option>
                {residents.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Pickup address *</label>
              <input className="input" placeholder="Full pickup address" value={form.pickupAddress} onChange={e => set('pickupAddress', e.target.value)} required />
            </div>
            <div>
              <label className="label">Drop-off address *</label>
              <input className="input" placeholder="Full drop-off address" value={form.dropoffAddress} onChange={e => set('dropoffAddress', e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Pattern *</label>
                <select className="input" value={form.pattern} onChange={e => set('pattern', e.target.value)}>
                  {PATTERNS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Time *</label>
                <input type="time" className="input" value={form.scheduledTime} onChange={e => set('scheduledTime', e.target.value)} required />
              </div>
            </div>
            {['WEEKLY', 'FORTNIGHTLY'].includes(form.pattern) && (
              <div>
                <label className="label">Day of week</label>
                <select className="input" value={form.dayOfWeek} onChange={e => set('dayOfWeek', Number(e.target.value))}>
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            {form.pattern === 'MONTHLY' && (
              <div>
                <label className="label">Day of month</label>
                <input type="number" min={1} max={28} className="input" value={form.dayOfMonth} onChange={e => set('dayOfMonth', Number(e.target.value))} />
              </div>
            )}
            <div>
              <label className="label">Flat fare override (£) — leave blank for distance-band pricing</label>
              <input type="number" step="0.01" min="0" className="input" placeholder="e.g. 25.00" value={form.flatFare} onChange={e => set('flatFare', e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any regular notes for the driver" />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Create Schedule'}</button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-slate-400 text-sm">Loading…</div>
      ) : recurring.length === 0 ? (
        <div className="card p-12 text-center">
          <Repeat2 size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No recurring schedules yet.</p>
          <button className="btn-primary mt-4" onClick={() => setShowForm(true)}><Plus size={16} /> Create first schedule</button>
        </div>
      ) : (
        <div className="space-y-3">
          {recurring.map(r => (
            <div key={r.id} className={clsx('card p-4 flex items-start gap-4', !r.isActive && 'opacity-60')}>
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Repeat2 size={18} className="text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-800">{r.resident?.name}</p>
                  <span className={clsx('badge', r.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                    {r.isActive ? 'Active' : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">{describePattern(r)} at {r.scheduledTime}</p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{r.pickupAddress} → {r.dropoffAddress}</p>
                {r.flatFare && <p className="text-xs text-brand-600 font-medium mt-0.5">Fixed fare: £{r.flatFare.toFixed(2)}</p>}
              </div>
              <button
                onClick={() => toggleActive(r.id, r.isActive)}
                className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                title={r.isActive ? 'Pause' : 'Resume'}
              >
                {r.isActive ? <ToggleRight size={22} className="text-green-500" /> : <ToggleLeft size={22} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
