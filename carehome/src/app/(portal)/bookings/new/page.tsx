'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin } from 'lucide-react'
import { api, CareHomeResident } from '@/lib/api'
import toast from 'react-hot-toast'

export default function NewBookingPage() {
  const router = useRouter()
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    residentId: '',
    pickupAddress: '',
    pickupLat: 51.5074,
    pickupLng: -0.1278,
    dropoffAddress: '',
    dropoffLat: 51.5074,
    dropoffLng: -0.1278,
    scheduledAt: '',
    notes: '',
  })

  useEffect(() => {
    api.get<CareHomeResident[]>('/carehome/residents').then(setResidents)
  }, [])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.residentId) return toast.error('Please select a resident')
    if (!form.pickupAddress) return toast.error('Pickup address required')
    if (!form.dropoffAddress) return toast.error('Drop-off address required')
    if (!form.scheduledAt) return toast.error('Date and time required')

    setSaving(true)
    try {
      await api.post('/carehome/bookings', {
        residentId: form.residentId,
        pickupAddress: form.pickupAddress,
        pickupLat: form.pickupLat,
        pickupLng: form.pickupLng,
        dropoffAddress: form.dropoffAddress,
        dropoffLat: form.dropoffLat,
        dropoffLng: form.dropoffLng,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        notes: form.notes || undefined,
      })
      toast.success('Booking created')
      router.push('/bookings')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Min datetime = now + 30 mins
  const minDateTime = new Date(Date.now() + 30 * 60 * 1000)
    .toISOString().slice(0, 16)

  return (
    <div>
      <div className="page-header">
        <Link href="/bookings" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft size={15} /> Back to Bookings
        </Link>
        <h1 className="page-title">New Booking</h1>
        <p className="page-subtitle">Book transport for a resident</p>
      </div>

      <div className="max-w-xl">
        <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          {/* Resident */}
          <div>
            <label className="label">Resident *</label>
            {residents.length === 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                No residents found. <Link href="/residents/new" className="underline font-medium">Add a resident first.</Link>
              </div>
            ) : (
              <select
                className="input"
                value={form.residentId}
                onChange={e => set('residentId', e.target.value)}
                required
              >
                <option value="">Select resident…</option>
                {residents.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.mobility.replace('_', ' ')})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Pickup */}
          <div>
            <label className="label">Pickup address *</label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-3 text-brand-500" />
              <input
                className="input pl-8"
                placeholder="Full pickup address"
                value={form.pickupAddress}
                onChange={e => set('pickupAddress', e.target.value)}
                required
              />
            </div>
          </div>

          {/* Drop-off */}
          <div>
            <label className="label">Drop-off address *</label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-3 text-slate-400" />
              <input
                className="input pl-8"
                placeholder="Full drop-off address (e.g. hospital name and address)"
                value={form.dropoffAddress}
                onChange={e => set('dropoffAddress', e.target.value)}
                required
              />
            </div>
          </div>

          {/* Date/time */}
          <div>
            <label className="label">Date & time *</label>
            <input
              type="datetime-local"
              className="input"
              min={minDateTime}
              value={form.scheduledAt}
              onChange={e => set('scheduledAt', e.target.value)}
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label className="label">Driver notes</label>
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="Any special instructions for the driver…"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>

          <div className="p-3 bg-brand-50 border border-brand-100 rounded-lg">
            <p className="text-xs text-brand-700 font-medium">
              💡 Fare is calculated automatically using care home distance-band pricing. Payment is by monthly invoice.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || residents.length === 0} className="btn-primary">
              {saving ? 'Creating…' : 'Create Booking'}
            </button>
            <Link href="/bookings" className="btn-ghost">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
