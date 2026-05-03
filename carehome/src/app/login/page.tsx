'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Car, Heart } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/lib/api'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      router.replace('/dashboard')
    } catch (err: any) {
      toast.error(err.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-500 rounded-2xl mb-4 shadow-lg shadow-brand-500/25">
            <Car size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            <span className="text-brand-500">Orange</span>Ride
          </h1>
          <div className="inline-flex items-center gap-1.5 mt-1.5 px-3 py-1 bg-care-100 rounded-full">
            <Heart size={11} className="text-care-600" />
            <span className="text-xs font-semibold text-care-700 uppercase tracking-wider">Care Home Portal</span>
          </div>
        </div>

        {/* Form */}
        <div className="card p-6 shadow-xl shadow-slate-200/50">
          <h2 className="text-base font-bold text-slate-800 mb-5">Sign in to your portal</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="you@carehome.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center mt-2"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Need access? Contact your OrangeRide account manager.
        </p>
      </div>
    </div>
  )
}
