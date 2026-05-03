'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, CalendarDays, Repeat2,
  FileText, LogOut, Car, X, Heart,
} from 'lucide-react'
import { useAuthStore } from '@/lib/api'
import { clsx } from 'clsx'

const nav = [
  { href: '/dashboard', label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/residents', label: 'Residents',    icon: Users },
  { href: '/bookings',  label: 'Bookings',     icon: CalendarDays },
  { href: '/recurring', label: 'Recurring',    icon: Repeat2 },
  { href: '/invoices',  label: 'Invoices',     icon: FileText },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { staff, account, logout } = useAuthStore()

  const content = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shrink-0">
              <Car size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold leading-none">
                <span className="text-brand-500">Orange</span>
                <span className="text-slate-800">Ride</span>
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider font-medium">
                Care Home
              </p>
            </div>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {account && (
          <div className="mt-3 px-2.5 py-2 bg-care-50 rounded-lg border border-care-100">
            <div className="flex items-center gap-1.5">
              <Heart size={11} className="text-care-600 shrink-0" />
              <p className="text-xs font-semibold text-care-700 truncate">{account.name}</p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href} onClick={onClose}>
              <span className={clsx('sidebar-link', active && 'active')}>
                <Icon size={16} />
                {label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 pb-4 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold shrink-0">
            {staff?.name?.[0] ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-700 truncate">{staff?.name}</p>
            <p className="text-[10px] text-slate-400 truncate">{staff?.email}</p>
          </div>
          <button
            onClick={logout}
            className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
            title="Log out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* ── Desktop sidebar ── always visible on lg+ */}
      <aside className="hidden lg:flex lg:flex-col w-56 shrink-0 h-screen sticky top-0 bg-white border-r border-slate-100">
        {content}
      </aside>

      {/* ── Mobile drawer ── slide-in overlay */}
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/30 z-40 lg:hidden transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />
      {/* Drawer panel */}
      <aside
        className={clsx(
          'fixed top-0 left-0 h-full w-64 bg-white border-r border-slate-100 z-50 lg:hidden',
          'transform transition-transform duration-250 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {content}
      </aside>
    </>
  )
}
