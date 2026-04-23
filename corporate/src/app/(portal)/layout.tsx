'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { useAuthStore } from '@/lib/api'
import { Spinner } from '@/components/ui'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { token, _hasHydrated } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (_hasHydrated && !token) router.replace('/login')
  }, [_hasHydrated, token])

  if (!_hasHydrated) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Spinner size={24} />
      </div>
    )
  }

  if (!token) return null

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
