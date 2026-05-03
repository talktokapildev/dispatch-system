"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { useAuthStore } from "@/lib/api";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");
      if (!token) router.replace("/login");
    }
  }, []);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">
              <span className="text-brand-500">Orange</span>
              <span className="text-slate-800">Ride</span>
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Corporate
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
