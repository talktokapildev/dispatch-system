import { useRef } from 'react'
import { Animated, PanResponder } from 'react-native'

export function useBottomSheet(collapsed: number, expanded: number) {
  const sheetHeight = useRef(new Animated.Value(collapsed)).current
  const isExpanded  = useRef(false)

  const expandSheet = () => {
    isExpanded.current = true
    Animated.spring(sheetHeight, { toValue: expanded, useNativeDriver: false, tension: 80 }).start()
  }

  const collapseSheet = () => {
    isExpanded.current = false
    Animated.spring(sheetHeight, { toValue: collapsed, useNativeDriver: false, tension: 80 }).start()
  }

  const toggleSheet = () => isExpanded.current ? collapseSheet() : expandSheet()

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy, dx }) =>
        Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 5,
      onPanResponderGrant: () => {},
      onPanResponderMove: (_, { dy }) => {
        if (!isExpanded.current && dy < 0) {
          sheetHeight.setValue(collapsed + Math.abs(dy))
        } else if (isExpanded.current && dy > 0) {
          sheetHeight.setValue(Math.max(collapsed, expanded - dy))
        }
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (!isExpanded.current && (dy < -60 || vy < -0.5)) expandSheet()
        else if (isExpanded.current && (dy > 60 || vy > 0.5)) collapseSheet()
        else {
          Animated.spring(sheetHeight, {
            toValue: isExpanded.current ? expanded : collapsed,
            useNativeDriver: false,
          }).start()
        }
      },
    })
  ).current

  return { sheetHeight, isExpanded, expandSheet, collapseSheet, toggleSheet, panResponder }
}
