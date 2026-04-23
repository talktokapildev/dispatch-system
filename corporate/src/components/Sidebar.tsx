'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, PlusCircle, BookOpen, FileText, User, LogOut, Car } from 'lucide-react'
import { useAuthStore } from '@/lib/api'
import { clsx } from 'clsx'

const nav = [
  { href: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/book',      label: 'Book a Car',  icon: PlusCircle },
  { href: '/bookings',  label: 'Bookings',    icon: BookOpen },
  { href: '/invoices',  label: 'Invoices',    icon: FileText },
  { href: '/account',   label: 'Account',     icon: User },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()

  return (
    <aside className="w-56 shrink-0 h-screen flex flex-col sticky top-0 bg-white border-r border-slate-100">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-slate-100">
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
              Corporate
            </p>
          </div>
        </div>
        {user?.corporateAccount && (
          <div className="mt-3 px-2 py-1.5 bg-slate-50 rounded-lg">
            <p className="text-xs font-semibold text-slate-700 truncate">{user.corporateAccount.companyName}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}>
              <span className={clsx('sidebar-link', active && 'active')}>
                <Icon size={16} />
                {label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Credit balance */}
      {user?.corporateAccount && (
        <div className="px-4 py-3 mx-3 mb-3 bg-brand-50 rounded-xl border border-brand-100">
          <p className="text-[10px] text-brand-600 font-semibold uppercase tracking-wide">Account Balance</p>
          <p className="text-lg font-bold text-brand-600 mt-0.5">
            £{user.corporateAccount.currentBalance.toFixed(2)}
          </p>
          <p className="text-[10px] text-brand-400 mt-0.5">
            of £{user.corporateAccount.creditLimit.toFixed(0)} limit
          </p>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 bg-brand-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (user.corporateAccount.currentBalance / user.corporateAccount.creditLimit) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* User */}
      <div className="px-3 pb-4 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold shrink-0">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-700 truncate">{user?.firstName} {user?.lastName}</p>
            <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
          </div>
          <button onClick={logout} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  )
}
