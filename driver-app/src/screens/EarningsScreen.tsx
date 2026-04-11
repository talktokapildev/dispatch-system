import React, { useState, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../lib/api'
import { FontSize, Spacing, Radius } from '../lib/theme'
import { useTheme } from '../lib/ThemeContext'
import { format, subDays, startOfWeek, endOfWeek, startOfMonth } from 'date-fns'

const PERIODS = [
  { label: 'Today',       getValue: () => ({ from: format(new Date(), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'This Week',   getValue: () => ({ from: format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') }) },
  { label: 'This Month',  getValue: () => ({ from: format(startOfMonth(new Date()), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
  { label: 'Last 30 Days',getValue: () => ({ from: format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: format(new Date(), 'yyyy-MM-dd') }) },
]

export default function EarningsScreen() {
  const { Colors } = useTheme()
  const [periodIdx, setPeriodIdx] = useState(0)
  const [earnings, setEarnings] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchEarnings() }, [periodIdx])

  const fetchEarnings = async () => {
    setLoading(true)
    try {
      const { from, to } = PERIODS[periodIdx].getValue()
      const { data } = await api.get('/drivers/earnings', { params: { from, to } })
      setEarnings(data.data)
    } catch { setEarnings(null) }
    finally { setLoading(false) }
  }

  const summary = earnings?.summary
  const s = styles(Colors)

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Earnings</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.periodScroll}>
        {PERIODS.map((p, i) => (
          <TouchableOpacity
            key={p.label}
            style={[s.periodBtn, i === periodIdx && s.periodBtnActive]}
            onPress={() => setPeriodIdx(i)}
          >
            <Text style={[s.periodBtnText, i === periodIdx && s.periodBtnTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView>
        {loading ? (
          <View style={s.loadingBox}><ActivityIndicator color={Colors.brand} /></View>
        ) : (
          <>
            <View style={s.summaryGrid}>
              <View style={[s.summaryCard, s.summaryCardLarge]}>
                <Text style={s.summaryMainLabel}>Net Earnings</Text>
                <Text style={s.summaryMain}>£{(summary?.totalNet ?? 0).toFixed(2)}</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>Gross</Text>
                <Text style={s.summaryValue}>£{(summary?.totalGross ?? 0).toFixed(2)}</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>Platform Fee</Text>
                <Text style={[s.summaryValue, { color: Colors.muted }]}>-£{(summary?.totalFees ?? 0).toFixed(2)}</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>Jobs</Text>
                <Text style={s.summaryValue}>{summary?.jobCount ?? 0}</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryLabel}>Avg / Job</Text>
                <Text style={s.summaryValue}>£{summary?.jobCount ? (summary.totalNet / summary.jobCount).toFixed(2) : '0.00'}</Text>
              </View>
            </View>

            <View style={s.section}>
              <Text style={s.sectionTitle}>Job Breakdown</Text>
              {earnings?.earnings?.length === 0 ? (
                <View style={s.emptyBox}><Text style={s.emptyText}>No jobs in this period</Text></View>
              ) : (
                earnings?.earnings?.map((e: any) => (
                  <View key={e.id} style={s.earningRow}>
                    <View>
                      <Text style={s.earningDate}>{format(new Date(e.createdAt), 'dd MMM · HH:mm')}</Text>
                      <Text style={s.earningFee}>Fee: £{e.platformFee.toFixed(2)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.earningGross}>£{e.grossAmount.toFixed(2)}</Text>
                      <Text style={s.earningNet}>£{e.netAmount.toFixed(2)} net</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = (C: ReturnType<typeof import('../lib/ThemeContext').useTheme>['Colors']) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { padding: Spacing.lg, paddingBottom: Spacing.sm },
  title: { fontSize: FontSize.xxl, fontWeight: '700', color: C.white },
  periodScroll: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  periodBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, marginRight: Spacing.sm, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  periodBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
  periodBtnText: { fontSize: FontSize.sm, color: C.muted, fontWeight: '600' },
  periodBtnTextActive: { color: '#000' },
  loadingBox: { padding: Spacing.xxl, alignItems: 'center' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg },
  summaryCard: { flex: 1, minWidth: '45%', backgroundColor: C.card, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, padding: Spacing.md },
  summaryCardLarge: { minWidth: '100%' },
  summaryMainLabel: { fontSize: FontSize.sm, color: C.muted, marginBottom: 4 },
  summaryMain: { fontSize: FontSize.xxxl, fontWeight: '800', color: C.brand },
  summaryLabel: { fontSize: FontSize.xs, color: C.muted, marginBottom: 2 },
  summaryValue: { fontSize: FontSize.lg, fontWeight: '700', color: C.white },
  section: { paddingHorizontal: Spacing.lg },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '600', color: C.white, marginBottom: Spacing.sm },
  emptyBox: { padding: Spacing.xl, alignItems: 'center' },
  emptyText: { color: C.muted, fontSize: FontSize.sm },
  earningRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.sm },
  earningDate: { fontSize: FontSize.sm, color: C.white, fontWeight: '500' },
  earningFee: { fontSize: FontSize.xs, color: C.muted, marginTop: 2 },
  earningGross: { fontSize: FontSize.sm, color: C.muted },
  earningNet: { fontSize: FontSize.md, color: C.brand, fontWeight: '700' },
})
