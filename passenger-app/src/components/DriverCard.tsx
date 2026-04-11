import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { FontSize, Spacing, Radius } from '../lib/theme'

interface DriverCardProps {
  driver: {
    firstName?: string
    lastName?: string
    pcoBadgeNumber?: string
    rating?: number
    vehicle?: {
      make?: string
      model?: string
      licensePlate?: string
      color?: string
    }
  }
}

export default function DriverCard({ driver }: DriverCardProps) {
  const { Colors } = useTheme()
  const s = styles(Colors)

  const initials = `${driver.firstName?.[0] ?? '?'}${driver.lastName?.[0] ?? ''}`

  return (
    <View style={s.card}>
      {/* Avatar + name */}
      <View style={s.row}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        <View style={s.info}>
          <Text style={s.name}>{driver.firstName} {driver.lastName}</Text>
          {driver.rating != null && (
            <Text style={s.rating}>★ {driver.rating.toFixed(1)}</Text>
          )}
          {driver.pcoBadgeNumber && (
            <Text style={s.badge}>PCO {driver.pcoBadgeNumber}</Text>
          )}
        </View>
      </View>

      {/* Vehicle */}
      {driver.vehicle && (
        <View style={s.vehicleRow}>
          <Text style={s.vehicleText}>
            🚗 {driver.vehicle.color ? `${driver.vehicle.color} ` : ''}
            {driver.vehicle.make} {driver.vehicle.model}
          </Text>
          <View style={s.plateBadge}>
            <Text style={s.plateText}>{driver.vehicle.licensePlate}</Text>
          </View>
        </View>
      )}
    </View>
  )
}

const styles = (C: ReturnType<typeof import('../lib/ThemeContext').useTheme>['Colors']) =>
  StyleSheet.create({
    card:        { backgroundColor: C.bg, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.sm },
    row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.sm },
    avatar:      { width: 48, height: 48, borderRadius: 24, backgroundColor: C.brand + '20', borderWidth: 2, borderColor: C.brand + '40', alignItems: 'center', justifyContent: 'center' },
    avatarText:  { color: C.brand, fontWeight: '800', fontSize: FontSize.lg },
    info:        { flex: 1 },
    name:        { fontSize: FontSize.md, fontWeight: '700', color: C.white },
    rating:      { fontSize: FontSize.sm, color: '#f59e0b', fontWeight: '600', marginTop: 2 },
    badge:       { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
    vehicleRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    vehicleText: { fontSize: FontSize.sm, color: C.text, flex: 1 },
    plateBadge:  { backgroundColor: C.card, borderRadius: Radius.sm, borderWidth: 1, borderColor: C.border, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
    plateText:   { fontSize: FontSize.sm, color: C.brand, fontWeight: '800', fontFamily: 'monospace' },
  })
