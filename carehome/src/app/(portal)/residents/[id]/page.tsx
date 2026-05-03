'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { api, CareHomeResident } from '@/lib/api'
import toast from 'react-hot-toast'

const MOBILITY_OPTIONS = [
  { value: 'AMBULATORY', label: 'Ambulatory — walks unaided' },
  { value: 'WALKING_AID', label: 'Walking Aid — stick or walker' },
  { value: 'WHEELCHAIR', label: 'Wheelchair — self-propelled' },
  { value: 'WHEELCHAIR_ASSIST', label: 'Wheelchair Assist — needs pushing' },
  { value: 'STRETCHER', label: 'Stretcher — lying down transport' },
]

export default function EditResidentPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', dateOfBirth: '', mobility: 'AMBULATORY',
    accessNotes: '', medicalNotes: '', contactName: '', contactPhone: '',
  })

  useEffect(() => {
    api.get<CareHomeResident[]>('/carehome/residents').then(list => {
      const r = list.find(x => x.id === id)
      if (r) {
        setForm({
          name: r.name,
          dateOfBirth: r.dateOfBirth ? r.dateOfBirth.slice(0, 10) : '',
          mobility: r.mobility,
          accessNotes: r.accessNotes ?? '',
          medicalNotes: r.medicalNotes ?? '',
          contactName: r.contactName ?? '',
          contactPhone: r.contactPhone ?? '',
        })
      }
    })
  }, [id])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put(`/carehome/residents/${id}`, {
        ...form,
        dateOfBirth: form.dateOfBirth || undefined,
        accessNotes: form.accessNotes || undefined,
        medicalNotes: form.medicalNotes || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
      })
      toast.success('Resident updated')
      router.push('/residents')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <Link href="/residents" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft size={15} /> Back to Residents
        </Link>
        <h1 className="page-title">Edit Resident</h1>
      </div>
      <div className="max-w-xl">
        <form onSubmit={handleSubmit} className="card p-6 space-y-5">
          <div>
            <label className="label">Full name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Date of birth</label>
              <input type="date" className="input" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
            </div>
            <div>
              <label className="label">Mobility *</label>
              <select className="input" value={form.mobility} onChange={e => set('mobility', e.target.value)}>
                {MOBILITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Access / boarding notes</label>
            <textarea className="input resize-none" rows={2} value={form.accessNotes} onChange={e => set('accessNotes', e.target.value)} />
          </div>
          <div>
            <label className="label">Medical notes</label>
            <textarea className="input resize-none" rows={2} value={form.medicalNotes} onChange={e => set('medicalNotes', e.target.value)} />
          </div>
          <hr className="border-slate-100" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Next of Kin</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Contact name</label>
              <input className="input" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
            </div>
            <div>
              <label className="label">Contact phone</label>
              <input className="input" value={form.contactPhone} onChange={e => set('contactPhone', e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <Link href="/residents" className="btn-ghost">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
