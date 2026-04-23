'use client'
import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'

interface Props {
  value: string
  onChange: (address: string, lat: number, lng: number) => void
  placeholder?: string
  label?: string
}

declare global {
  interface Window { google: any }
}

export function AddressPicker({ value, onChange, placeholder = 'Enter address', label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.google?.maps?.places) { setLoaded(true); return }

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    if (!key) return

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
    script.async = true
    script.onload = () => setLoaded(true)
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    if (!loaded || !inputRef.current) return
    const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'gb' },
      fields: ['formatted_address', 'geometry'],
    })
    ac.addListener('place_changed', () => {
      const place = ac.getPlace()
      if (place.geometry?.location) {
        onChange(
          place.formatted_address ?? '',
          place.geometry.location.lat(),
          place.geometry.location.lng()
        )
      }
    })
  }, [loaded])

  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="relative">
        <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          defaultValue={value}
          placeholder={placeholder}
          className="input pl-8"
        />
      </div>
    </div>
  )
}
