import { useState } from 'react'
import { api } from '../lib/api'
import { decodePolyline, isHeadingToPickup } from '../lib/mapUtils'

interface Coords {
  latitude: number
  longitude: number
}

export function useJobRoute(initialCoords?: Coords[]) {
  const [routeCoords, setRouteCoords] = useState<Coords[]>(initialCoords ?? [])

  const fetchRoute = async (driverCoords: Coords, booking: any) => {
    const toPickup = isHeadingToPickup(booking.status)
    const destLat  = toPickup ? booking.pickupLatitude  : booking.dropoffLatitude
    const destLng  = toPickup ? booking.pickupLongitude : booking.dropoffLongitude

    try {
      const { data } = await api.get('/maps/directions', {
        params: {
          originLat: driverCoords.latitude,
          originLng: driverCoords.longitude,
          destLat,
          destLng,
        },
      })
      if (data.data?.polyline) {
        setRouteCoords(decodePolyline(data.data.polyline))
      }
    } catch {
      // Fallback straight line
      setRouteCoords([driverCoords, { latitude: destLat, longitude: destLng }])
    }
  }

  return { routeCoords, setRouteCoords, fetchRoute }
}
