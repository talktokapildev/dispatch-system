import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { FontSize, Spacing, Radius } from '../lib/theme'

export const JOB_STEPS = [
  { status: 'DRIVER_EN_ROUTE', label: 'On My Way',  desc: 'Heading to pickup',  icon: '🚗', color: '#6366f1' },
  { status: 'DRIVER_ARRIVED',  label: 'Arrived',    desc: 'At pickup location', icon: '📍', color: '#06b6d4' },
  { status: 'IN_PROGRESS',     label: 'Start Trip', desc: 'Passenger onboard',  icon: '▶️', color: '#f59e0b' },
  { status: 'COMPLETED',       label: 'Complete',   desc: 'Trip finished',       icon: '✅', color: '#22c55e' },
]

export const STEP_STATUSES = ['DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']
export const STATUS_ORDER  = ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS']

export function getCurrentStepIndex(status: string): number {
  const idx = STATUS_ORDER.indexOf(status)
  return idx === -1 ? 0 : idx
}

export function getNextStep(status: string) {
  const currentIdx = getCurrentStepIndex(status)
  return JOB_STEPS.find(s => s.status === STEP_STATUSES[currentIdx])
}

interface Props {
  status: string
}

export default function JobStepProgress({ status }: Props) {
  const { Colors } = useTheme()
  const currentIdx = getCurrentStepIndex(status)
  const s = styles(Colors)

  return (
    <View style={s.container}>
      {JOB_STEPS.map((step, i) => {
        const isDone    = i < currentIdx
        const isCurrent = i === currentIdx
        return (
          <View key={step.status} style={s.stepRow}>
            <View style={[
              s.circle,
              isDone    && { backgroundColor: Colors.success },
              isCurrent && { backgroundColor: step.color, borderColor: step.color },
            ]}>
              <Text style={s.icon}>{isDone ? '✓' : step.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, (isDone || isCurrent) && { color: Colors.white }]}>
                {step.label}
              </Text>
              <Text style={s.desc}>{step.desc}</Text>
            </View>
            {i < JOB_STEPS.length - 1 && <View style={s.line} />}
          </View>
        )
      })}
    </View>
  )
}

const styles = (C: ReturnType<typeof import('../lib/ThemeContext').useTheme>['Colors']) =>
  StyleSheet.create({
    container: {
      backgroundColor: C.bg, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.sm,
    },
    stepRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
    circle:   { width: 32, height: 32, borderRadius: 16, backgroundColor: C.border, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
    icon:     { fontSize: 14 },
    label:    { fontSize: FontSize.sm, fontWeight: '600', color: C.muted },
    desc:     { fontSize: FontSize.xs, color: C.muted },
    line:     { position: 'absolute', left: 15, top: 32, width: 2, height: Spacing.sm, backgroundColor: C.border },
  })
