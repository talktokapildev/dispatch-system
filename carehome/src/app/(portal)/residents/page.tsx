'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Pencil, UserX, Phone, ChevronRight } from 'lucide-react'
import { api, CareHomeResident } from '@/lib/api'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'

const MOBILITY_LABELS: Record<string, string> = {
  AMBULATORY: 'Ambulatory',
  WALKING_AID: 'Walking Aid',
  WHEELCHAIR: 'Wheelchair',
  WHEELCHAIR_ASSIST: 'W/C Assist',
  STRETCHER: 'Stretcher',
}

export default function ResidentsPage() {
  const [residents, setResidents] = useState<CareHomeResident[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<CareHomeResident[]>('/carehome/residents')
      .then(setResidents)
      .finally(() => setLoading(false))
  }, [])

  const deactivate = async (id: string, name: string) => {
    if (!confirm(`Deactivate ${name}?`)) return
    try {
      await api.delete(`/carehome/residents/${id}`)
      setResidents(r => r.filter(x => x.id !== id))
      toast.success('Resident deactivated')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const filtered = residents.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Residents</h1>
          <p className="page-subtitle">{residents.length} registered residents</p>
        </div>
        <Link href="/residents/new" className="btn-primary self-start sm:self-auto">
          <Plus size={16} /> Add Resident
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="Search residents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card p-12 text-center text-slate-400 text-sm">Loading residents…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-slate-400 text-sm">No residents found.</p>
          <Link href="/residents/new" className="btn-primary mt-4 inline-flex">
            <Plus size={16} /> Add first resident
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden md:block overflow-hidden">
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Mobility</th>
                    <th className="px-5 py-3">Next of Kin</th>
                    <th className="px-5 py-3">Access Notes</th>
                    <th className="px-5 py-3 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="table-row">
                      <td className="px-5 py-3.5 font-medium text-slate-800">{r.name}</td>
                      <td className="px-5 py-3.5">
                        <span className={clsx('badge', `mobility-${r.mobility}`)}>
                          {MOBILITY_LABELS[r.mobility] ?? r.mobility}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {r.contactName && (
                          <div>
                            <p className="text-xs">{r.contactName}</p>
                            {r.contactPhone && (
                              <p className="text-xs text-slate-400">{r.contactPhone}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs max-w-[200px] truncate">
                        {r.accessNotes ?? '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1">
                          <Link href={`/residents/${r.id}`} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-brand-600 transition-colors">
                            <Pencil size={14} />
                          </Link>
                          <button
                            onClick={() => deactivate(r.id, r.name)}
                            className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <UserX size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map(r => (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800">{r.name}</p>
                      <span className={clsx('badge', `mobility-${r.mobility}`)}>
                        {MOBILITY_LABELS[r.mobility] ?? r.mobility}
                      </span>
                    </div>
                    {r.accessNotes && (
                      <p className="text-xs text-slate-500 mt-1">{r.accessNotes}</p>
                    )}
                    {r.contactName && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <Phone size={11} className="text-slate-400" />
                        <span className="text-xs text-slate-500">{r.contactName}{r.contactPhone ? ` · ${r.contactPhone}` : ''}</span>
                      </div>
                    )}
                  </div>
                  <Link href={`/residents/${r.id}`} className="p-2 text-slate-400 hover:text-brand-500 transition-colors">
                    <ChevronRight size={18} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
