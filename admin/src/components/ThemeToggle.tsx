'use client'
import { useTheme } from '@/app/providers'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 hover:opacity-80"
      style={{ background: 'var(--table-hover)', border: '1px solid var(--border)' }}
    >
      {theme === 'dark'
        ? <Sun size={15} className="text-brand-400" />
        : <Moon size={15} className="text-slate-500" />
      }
    </button>
  )
}