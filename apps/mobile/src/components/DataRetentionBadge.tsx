import type { DataRetentionTag } from '@pulpo/contracts'
import { Alert, Pressable, StyleSheet } from 'react-native'
import { Circle, type LucideIcon } from 'lucide-react-native'
import * as LucideIcons from 'lucide-react-native/icons'
import { dataRetentionBadgeColors, lucideComponentName } from './data-retention-badge'

type BadgeTag = Pick<DataRetentionTag, 'name' | 'description' | 'icon' | 'color'>

const icons = LucideIcons as unknown as Record<string, LucideIcon | undefined>

/** Native counterpart to web's hover badge; touch has no hover, so a tap shows the description. */
export function DataRetentionBadge({ tag }: { tag: BadgeTag }) {
  const Icon = icons[lucideComponentName(tag.icon)] ?? Circle
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tag.description ? `${tag.name}. ${tag.description}` : tag.name}
      hitSlop={10}
      onPress={() => Alert.alert(tag.name, tag.description || undefined)}
      style={({ pressed }) => [styles.badge, dataRetentionBadgeColors(tag.color), pressed && styles.pressed]}
    >
      <Icon color={tag.color} size={12} strokeWidth={2.25} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
})
