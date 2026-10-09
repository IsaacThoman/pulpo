import { Text, View } from 'react-native'
import type { MobileModel } from '@/types'
import { useTVTheme, type } from '../theme'
import { Focusable, type FocusableProps } from './Focusable'
import { Icon } from './Icon'
import { ModelIcon } from './ModelIcon'

export function ModelChip({ model, ...props }: Omit<FocusableProps, 'children'> & { model: MobileModel | null }) {
  const theme = useTVTheme()
  return <Focusable accessibilityRole="button" accessibilityLabel={model?.name ?? 'Model'} {...props}
    style={{ height: 76, borderRadius: 38, paddingLeft: 20, paddingRight: 28, justifyContent: 'center' }}>
    {(focused) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <ModelIcon model={model} size={40} inverted={focused} />
      <Text numberOfLines={1} style={{ maxWidth: 420, fontSize: type.label, fontWeight: '600', color: focused ? theme.focusText : theme.text }}>
        {model?.name ?? '…'}
      </Text>
      <Icon name="chevron.down" size={22} color={focused ? theme.focusText : theme.secondary} />
    </View>}
  </Focusable>
}
