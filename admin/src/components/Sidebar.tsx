"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Users,
  Car,
  Building2,
  BarChart3,
  LogOut,
  MapPin,
  FileText,
  AlertTriangle,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { useAuthStore } from "@/lib/api";
import { useTheme } from "@/app/providers";
import { clsx } from "clsx";

// Dark forest green from the OrangeRide logo — "Ride" text colour
const RIDE_GREEN = "#2d5a1b";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dispatch", label: "Live Dispatch", icon: MapPin },
  { href: "/bookings", label: "Bookings", icon: BookOpen },
  { href: "/drivers", label: "Drivers", icon: Car },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/corporate", label: "Corporate", icon: Building2 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <aside
      className="w-60 shrink-0 h-screen flex flex-col sticky top-0"
      style={{
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--border)",
      }}
    >
      {/* Logo */}
      <div
        className="px-5 pt-6 pb-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* Icon: orange square with white car, matching logo car colour */}
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shrink-0">
              <Car size={16} className="text-white" />
            </div>
            <div>
              {/* "Orange" in brand orange, "Ride" in logo dark green */}
              <p className="text-sm font-bold leading-none">
                <span className="text-brand-500">Orange</span>
                <span style={{ color: RIDE_GREEN }}>Ride</span>
              </p>
              <p
                className="text-[10px] font-mono mt-0.5 uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Control Centre
              </p>
            </div>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            title={`Switch to ${isDark ? "light" : "dark"} mode`}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
            style={{
              background: "var(--table-hover)",
              border: "1px solid var(--border)",
            }}
          >
            {isDark ? (
              <Sun size={13} className="text-brand-400" />
            ) : (
              <Moon size={13} className="text-slate-500" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href}>
              <span className={clsx("sidebar-link", active && "active")}>
                <Icon size={16} />
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div
        className="px-3 pb-4 pt-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center text-brand-500 text-xs font-bold shrink-0">
            {user?.firstName?.[0]}
            {user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-medium truncate"
              style={{ color: "var(--text)" }}
            >
              {user?.firstName} {user?.lastName}
            </p>
            <p
              className="text-[10px] truncate"
              style={{ color: "var(--text-muted)" }}
            >
              {user?.role}
            </p>
          </div>
          <button
            onClick={logout}
            className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
