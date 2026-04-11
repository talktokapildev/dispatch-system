import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { FontSize, Spacing, Radius } from '../lib/theme'

interface Props {
  passenger: {
    firstName?: string
    lastName?: string
    phone?: string
  }
}

export default function PassengerCard({ passenger }: Props) {
  const { Colors } = useTheme()
  const s = styles(Colors)

  const call = () => {
    if (passenger.phone) Linking.openURL(`tel:${passenger.phone}`)
  }

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>
            {passenger.firstName?.[0]}{passenger.lastName?.[0]}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{passenger.firstName} {passenger.lastName}</Text>
          <Text style={s.phone}>{passenger.phone}</Text>
        </View>
        <TouchableOpacity style={s.callBtn} onPress={call}>
          <Text style={s.callBtnText}>📞 Call</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = (C: ReturnType<typeof import('../lib/ThemeContext').useTheme>['Colors']) =>
  StyleSheet.create({
    card:        { backgroundColor: C.bg, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.sm },
    row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    avatar:      { width: 36, height: 36, borderRadius: 18, backgroundColor: C.brand + '20', alignItems: 'center', justifyContent: 'center' },
    avatarText:  { color: C.brand, fontWeight: '700', fontSize: FontSize.sm },
    name:        { fontSize: FontSize.sm, color: C.white, fontWeight: '600' },
    phone:       { fontSize: FontSize.xs, color: C.muted },
    callBtn:     { backgroundColor: C.success + '20', borderRadius: Radius.md, borderWidth: 1, borderColor: C.success + '40', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
    callBtnText: { color: C.success, fontWeight: '600', fontSize: FontSize.sm },
  })
