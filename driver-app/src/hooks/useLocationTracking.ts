import { useState, useRef, useEffect } from 'react'
import * as Location from 'expo-location'
import { api } from '../lib/api'

interface Coords {
  latitude: number
  longitude: number
}

interface UseLocationTrackingResult {
  location: Coords | null
  locationRef: React.MutableRefObject<Coords | null>
  getInitialLocation: () => Promise<Coords | null>
}

export function useLocationTracking(pollInterval = 8_000): UseLocationTrackingResult {
  const [location, setLocation] = useState<Coords | null>(null)
  const locationRef = useRef<Coords | null>(null)
  const intervalRef = useRef<NodeJS.Timeout>()

  const updateLocation = (coords: Coords) => {
    locationRef.current = coords
    setLocation(coords)
  }

  const getInitialLocation = async (): Promise<Coords | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return null
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      updateLocation(coords)
      return coords
    } catch {
      return null
    }
  }

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        const newCoords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
        updateLocation(newCoords)
        await api.post('/drivers/location', {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          bearing: Math.max(0, loc.coords.heading ?? 0),
          speed: loc.coords.speed ?? 0,
        })
      } catch {}
    }, pollInterval)

    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return { location, locationRef, getInitialLocation }
}
