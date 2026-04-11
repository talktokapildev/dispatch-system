import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthStore } from '../lib/api'
import { disconnectSocket } from '../lib/socket'
import { FontSize, Spacing, Radius } from '../lib/theme'
import { useTheme } from '../lib/ThemeContext'

export default function ProfileScreen({ navigation }: any) {
  const { Colors, theme, toggle } = useTheme()
  const { user, driver, logout } = useAuthStore()

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => { disconnectSocket(); logout() } },
    ])
  }

  const s = styles(Colors)

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  )

  return (
    <SafeAreaView style={s.container}>
      <ScrollView>
        {/* Avatar */}
        <View style={s.header}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{user?.firstName?.[0]}{user?.lastName?.[0]}</Text>
          </View>
          <Text style={s.name}>{user?.firstName} {user?.lastName}</Text>
          <Text style={s.phone}>{user?.phone}</Text>
          {driver && (
            <View style={s.ratingBadge}>
              <Text style={s.ratingText}>★ {driver.rating?.toFixed(1)} · {driver.totalJobs} jobs</Text>
            </View>
          )}
        </View>

        {/* Driver details */}
        {driver && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Driver Details</Text>
            <InfoRow label="PCO Badge" value={driver.pcoBadgeNumber ?? '—'} />
            <InfoRow label="Status" value={driver.status?.replace('_', ' ') ?? '—'} />
            <InfoRow label="Rating" value={`★ ${driver.rating?.toFixed(1)}`} />
            <InfoRow label="Total Jobs" value={String(driver.totalJobs)} />
          </View>
        )}

        {/* Vehicle */}
        {driver?.vehicle && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Vehicle</Text>
            <InfoRow label="Make & Model" value={`${driver.vehicle.make} ${driver.vehicle.model}`} />
            <InfoRow label="Licence Plate" value={driver.vehicle.licensePlate} />
            <InfoRow label="Class" value={driver.vehicle.class} />
          </View>
        )}

        {/* TfL */}
        <View style={[s.card, { backgroundColor: Colors.info + '08', borderColor: Colors.info + '30' }]}>
          <Text style={[s.cardTitle, { color: Colors.white, fontSize: FontSize.md }]}>🏛 TfL Compliance</Text>
          <Text style={{ fontSize: FontSize.sm, color: Colors.muted, lineHeight: 20, marginBottom: Spacing.md }}>
            Your PCO licence, vehicle documents, and insurance are monitored by your operator.
            You'll be notified when any document is approaching expiry.
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Documents')}>
            <Text style={{ color: Colors.brand, fontSize: FontSize.sm, fontWeight: '600' }}>View Documents →</Text>
          </TouchableOpacity>
        </View>

        {/* Theme toggle */}
        <TouchableOpacity style={s.themeCard} onPress={toggle}>
          <View style={s.themeRow}>
            <Text style={s.themeIcon}>{theme === 'dark' ? '☀️' : '🌙'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.themeLabel}>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</Text>
              <Text style={s.themeSub}>Currently {theme} theme</Text>
            </View>
            <Text style={{ color: Colors.brand, fontSize: FontSize.lg }}>→</Text>
          </View>
        </TouchableOpacity>

        {/* App info */}
        <View style={s.card}>
          <Text style={s.cardTitle}>App</Text>
          <InfoRow label="Version" value="1.0.0" />
          <InfoRow label="Build" value="Phase 2 MVP" />
        </View>

        {/* Logout */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={s.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = (C: ReturnType<typeof import('../lib/ThemeContext').useTheme>['Colors']) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { alignItems: 'center', padding: Spacing.xl },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.brand + '20', borderWidth: 3, borderColor: C.brand + '40', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  avatarText: { fontSize: FontSize.xxl, fontWeight: '800', color: C.brand },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: C.white },
  phone: { fontSize: FontSize.sm, color: C.muted, marginTop: 4 },
  ratingBadge: { marginTop: Spacing.sm, backgroundColor: C.brand + '20', borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 4, borderWidth: 1, borderColor: C.brand + '40' },
  ratingText: { color: C.brand, fontSize: FontSize.sm, fontWeight: '600' },
  card: { marginHorizontal: Spacing.lg, marginBottom: Spacing.md, backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.lg },
  cardTitle: { fontSize: FontSize.sm, color: C.muted, marginBottom: Spacing.sm, fontWeight: '600' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { fontSize: FontSize.sm, color: C.muted },
  infoValue: { fontSize: FontSize.sm, color: C.white, fontWeight: '500' },
  themeCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.md, backgroundColor: C.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border, padding: Spacing.md },
  themeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  themeIcon: { fontSize: 24 },
  themeLabel: { fontSize: FontSize.sm, fontWeight: '600', color: C.white },
  themeSub: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
  logoutBtn: { marginHorizontal: Spacing.lg, marginBottom: Spacing.xxl, backgroundColor: C.danger + '15', borderRadius: Radius.md, borderWidth: 1, borderColor: C.danger + '40', padding: Spacing.lg, alignItems: 'center' },
  logoutText: { color: C.danger, fontWeight: '700', fontSize: FontSize.md },
})
