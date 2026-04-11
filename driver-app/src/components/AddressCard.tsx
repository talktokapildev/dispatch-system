import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { FontSize, Spacing, Radius } from '../lib/theme'

interface Props {
  pickupAddress: string
  dropoffAddress: string
}

export default function AddressCard({ pickupAddress, dropoffAddress }: Props) {
  const { Colors } = useTheme()
  const s = styles(Colors)

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: Colors.success }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Pickup</Text>
          <Text style={s.text}>{pickupAddress}</Text>
        </View>
      </View>
      <View style={s.divider} />
      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: Colors.danger }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Dropoff</Text>
          <Text style={s.text}>{dropoffAddress}</Text>
        </View>
      </View>
    </View>
  )
}

const styles = (C: ReturnType<typeof import('../lib/ThemeContext').useTheme>['Colors']) =>
  StyleSheet.create({
    card:    { backgroundColor: C.bg, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.sm },
    row:     { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    dot:     { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    divider: { width: 2, height: 14, backgroundColor: C.border, marginLeft: 4, marginVertical: 3 },
    label:   { fontSize: FontSize.xs, color: C.muted },
    text:    { fontSize: FontSize.sm, color: C.white, fontWeight: '500' },
  })
