"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header
          className="lg:hidden sticky top-0 z-30 px-4 py-3 flex items-center gap-3"
          style={{
            background: "var(--sidebar-bg)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">
              <span className="text-brand-500">Orange</span>
              <span style={{ color: "#2d5a1b" }}>Ride</span>
            </span>
            <span
              className="text-[10px] font-mono uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Control Centre
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
