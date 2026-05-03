"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PlusCircle,
  BookOpen,
  FileText,
  User,
  LogOut,
  Car,
  X,
} from "lucide-react";
import { useAuthStore } from "@/lib/api";
import { clsx } from "clsx";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/book", label: "Book a Car", icon: PlusCircle },
  { href: "/bookings", label: "Bookings", icon: BookOpen },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/account", label: "Account", icon: User },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

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
                Corporate
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
        {user?.corporateAccount && (
          <div className="mt-3 px-2 py-1.5 bg-slate-50 rounded-lg">
            <p className="text-xs font-semibold text-slate-700 truncate">
              {user.corporateAccount.companyName}
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} onClick={onClose}>
              <span className={clsx("sidebar-link", active && "active")}>
                <Icon size={16} />
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Credit balance */}
      {user?.corporateAccount && (
        <div className="px-4 py-3 mx-3 mb-3 bg-brand-50 rounded-xl border border-brand-100">
          <p className="text-[10px] text-brand-600 font-semibold uppercase tracking-wide">
            Account Balance
          </p>
          <p className="text-lg font-bold text-brand-600 mt-0.5">
            £{user.corporateAccount.currentBalance?.toFixed(2) ?? "0.00"}
          </p>
          <p className="text-[10px] text-brand-400 mt-0.5">
            of £{user.corporateAccount.creditLimit?.toFixed(0) ?? "0"} limit
          </p>
          <div className="mt-2 h-1.5 bg-brand-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{
                width: `${Math.min(
                  100,
                  ((user.corporateAccount.currentBalance ?? 0) /
                    (user.corporateAccount.creditLimit || 1)) *
                    100
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* User */}
      <div className="px-3 pb-4 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-xs font-bold shrink-0">
            {user?.firstName?.[0]}
            {user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-700 truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar ── always visible lg+ */}
      <aside className="hidden lg:flex lg:flex-col w-56 shrink-0 h-screen sticky top-0 bg-white border-r border-slate-100">
        {content}
      </aside>

      {/* ── Mobile backdrop ── */}
      <div
        className={clsx(
          "fixed inset-0 bg-black/30 z-40 lg:hidden transition-opacity duration-200",
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* ── Mobile drawer ── */}
      <aside
        className={clsx(
          "fixed top-0 left-0 h-full w-64 bg-white border-r border-slate-100 z-50 lg:hidden",
          "transform transition-transform duration-250 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {content}
      </aside>
    </>
  );
}
