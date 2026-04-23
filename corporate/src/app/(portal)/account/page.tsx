'use client'
import { useState } from 'react'
import { useAuthStore, api } from '@/lib/api'
import { Spinner } from '@/components/ui'
import { Building2, Lock, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function AccountPage() {
  const { user } = useAuthStore()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [saving, setSaving] = useState(false)

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPw !== confirmPw) return toast.error('Passwords do not match')
    if (newPw.length < 8) return toast.error('Password must be at least 8 characters')
    setSaving(true)
    try {
      await api.post('/corporate/auth/change-password', { currentPassword: currentPw, newPassword: newPw })
      toast.success('Password updated')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to update password')
    } finally {
      setSaving(false)
    }
  }

  const acct = user?.corporateAccount

  return (
    <div className="animate-fade-in max-w-2xl space-y-6">
      <div className="page-header">
        <h1 className="page-title">Account</h1>
        <p className="page-subtitle">Your company and login details</p>
      </div>

      {/* Company details */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-5">
          <Building2 size={14} className="text-brand-500" /> Company Details
        </h2>
        <div className="space-y-3">
          {[
            { label: 'Company name',    value: acct?.companyName },
            { label: 'Contact name',    value: acct?.contactName },
            { label: 'Invoicing email', value: acct?.contactEmail },
            { label: 'Payment terms',   value: `${acct?.paymentTermsDays} days` },
            { label: 'Credit limit',    value: `£${acct?.creditLimit?.toFixed(2)}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">{label}</span>
              <span className="text-sm font-medium text-slate-800">{value ?? '—'}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-4">
          To update company details, contact{' '}
          <a href="mailto:admin@orangeride.co.uk" className="text-brand-500 hover:underline">admin@orangeride.co.uk</a>
        </p>
      </div>

      {/* Your profile */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Your Profile</h2>
        <div className="space-y-3">
          {[
            { label: 'Name',  value: `${user?.firstName} ${user?.lastName}` },
            { label: 'Email', value: user?.email },
            { label: 'Role',  value: user?.role },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
              <span className="text-sm text-slate-500">{label}</span>
              <span className="text-sm font-medium text-slate-800">{value ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Change password */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-5">
          <Lock size={14} className="text-brand-500" /> Change Password
        </h2>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="label">Current password</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              placeholder="••••••••" required className="input max-w-sm" />
          </div>
          <div>
            <label className="label">New password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="Min 8 characters" required className="input max-w-sm" />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              placeholder="Repeat new password" required className="input max-w-sm" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
            {saving ? <Spinner size={14} /> : <CheckCircle size={14} />}
            {saving ? 'Saving…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
