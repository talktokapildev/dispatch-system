'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, Bell } from 'lucide-react'
import { Sidebar } from '@/components/Sidebar'
import { useAuthStore } from '@/lib/api'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { token, loadFromStorage } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    loadFromStorage()
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = localStorage.getItem('ch_token')
      if (!t) router.replace('/login')
    }
  }, [token])

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar — hidden on desktop */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <span className="text-sm font-bold">
              <span className="text-brand-500">Orange</span>
              <span className="text-slate-800">Ride</span>
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Care Home</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  )
}
