'use client'
import { useState, useRef, useEffect } from 'react'
import { api } from '@/lib/api'
import { MapPin, Loader } from 'lucide-react'

interface AddressSuggestion {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

interface Props {
  value: string
  onChange: (address: string, lat: number, lng: number) => void
  placeholder?: string
  className?: string
}

export function AddressPicker({ value, onChange, placeholder = 'Search address...', className = '' }: Props) {
  const [query, setQuery] = useState(value)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const sessionToken = useRef(Math.random().toString(36).slice(2))
  const debounceRef = useRef<NodeJS.Timeout>()
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync value prop
  useEffect(() => { setQuery(value) }, [value])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = (q: string) => {
    setQuery(q)
    if (!q || q.length < 3) { setSuggestions([]); setOpen(false); return }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await api.get('/places/autocomplete', {
          params: { input: q, sessionToken: sessionToken.current },
        })
        setSuggestions(data.data ?? [])
        setOpen(true)
      } catch {
        // If Google Maps key not set, allow manual entry
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  const selectSuggestion = async (suggestion: AddressSuggestion) => {
    setQuery(suggestion.description)
    setOpen(false)
    setSuggestions([])

    // Get coordinates for selected place
    try {
      const { data } = await api.get('/places/details', {
        params: { placeId: suggestion.placeId },
      })
      onChange(suggestion.description, data.data.latitude, data.data.longitude)
    } catch {
      // Fallback — use address without coordinates
      onChange(suggestion.description, 51.5074, -0.1278)
    }

    // Reset session token after selection
    sessionToken.current = Math.random().toString(36).slice(2)
  }

  const handleManualEntry = () => {
    // Allow manual lat/lng if no autocomplete
    onChange(query, 51.5074, -0.1278)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          className={`input pl-8 pr-8 ${className}`}
          placeholder={placeholder}
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === 'Enter' && handleManualEntry()}
        />
        {loading && (
          <Loader size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onMouseDown={() => selectSuggestion(s)}
              className="w-full text-left px-3 py-2.5 hover:bg-[var(--table-hover)] transition-colors border-b border-[var(--border)] last:border-0"
            >
              <p className="text-xs text-[var(--text)] font-medium">{s.mainText}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{s.secondaryText}</p>
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 3 && suggestions.length === 0 && !loading && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl">
          <button
            type="button"
            onMouseDown={handleManualEntry}
            className="w-full text-left px-3 py-2.5 hover:bg-[var(--table-hover)] transition-colors"
          >
            <p className="text-xs text-white">Use: "{query}"</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Add Google Maps API key for autocomplete</p>
          </button>
        </div>
      )}
    </div>
  )
}
