import axios from 'axios'
import { config } from '../config'

interface DirectionsResult {
  distanceKm: number
  durationMinutes: number
  polyline: string
  steps: RouteStep[]
}

interface RouteStep {
  instruction: string
  distanceM: number
  durationS: number
}

interface GeocodeResult {
  address: string
  latitude: number
  longitude: number
  placeId: string
}

interface PlacePrediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export class MapsService {
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api'
  private readonly apiKey = config.GOOGLE_MAPS_API_KEY

  async getDirections(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    waypoints?: { lat: number; lng: number }[]
  ): Promise<DirectionsResult> {
    const params: Record<string, string> = {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      key: this.apiKey,
      units: 'metric',
    }

    if (waypoints?.length) {
      params.waypoints = waypoints.map((w) => `${w.lat},${w.lng}`).join('|')
    }

    const { data } = await axios.get(`${this.baseUrl}/directions/json`, { params })

    if (data.status !== 'OK') {
      throw new Error(`Maps API error: ${data.status}`)
    }

    const leg = data.routes[0].legs[0]
    return {
      distanceKm: leg.distance.value / 1000,
      durationMinutes: Math.ceil(leg.duration.value / 60),
      polyline: data.routes[0].overview_polyline.points,
      steps: leg.steps.map((s: any) => ({
        instruction: s.html_instructions.replace(/<[^>]*>/g, ''),
        distanceM: s.distance.value,
        durationS: s.duration.value,
      })),
    }
  }

  async geocode(address: string): Promise<GeocodeResult> {
    const { data } = await axios.get(`${this.baseUrl}/geocode/json`, {
      params: { address, key: this.apiKey, region: 'gb' },
    })

    if (data.status !== 'OK' || !data.results.length) {
      throw new Error(`Geocoding failed: ${data.status}`)
    }

    const result = data.results[0]
    return {
      address: result.formatted_address,
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      placeId: result.place_id,
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<string> {
    const { data } = await axios.get(`${this.baseUrl}/geocode/json`, {
      params: { latlng: `${lat},${lng}`, key: this.apiKey, region: 'gb' },
    })

    if (data.status !== 'OK' || !data.results.length) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    }

    return data.results[0].formatted_address
  }

  async autocomplete(input: string, sessionToken: string): Promise<PlacePrediction[]> {
    const { data } = await axios.get(`${this.baseUrl}/place/autocomplete/json`, {
      params: {
        input,
        key: this.apiKey,
        sessiontoken: sessionToken,
        components: 'country:gb',
        types: 'geocode',
      },
    })

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Autocomplete error: ${data.status}`)
    }

    return (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting.main_text,
      secondaryText: p.structured_formatting.secondary_text,
    }))
  }

  async getPlaceDetails(placeId: string): Promise<GeocodeResult> {
    const { data } = await axios.get(`${this.baseUrl}/place/details/json`, {
      params: {
        place_id: placeId,
        key: this.apiKey,
        fields: 'formatted_address,geometry',
      },
    })

    if (data.status !== 'OK') {
      throw new Error(`Place details error: ${data.status}`)
    }

    return {
      address: data.result.formatted_address,
      latitude: data.result.geometry.location.lat,
      longitude: data.result.geometry.location.lng,
      placeId,
    }
  }

  // Haversine distance between two points (km)
  haversineDistance(
    lat1: number, lng1: number,
    lat2: number, lng2: number
  ): number {
    const R = 6371
    const dLat = this.toRad(lat2 - lat1)
    const dLng = this.toRad(lng2 - lng1)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  private toRad(deg: number) {
    return deg * (Math.PI / 180)
  }
}
