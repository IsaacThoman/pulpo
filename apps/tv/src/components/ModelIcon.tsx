import { Image } from 'react-native'
import { aiIconSource } from '@/mockup5/src/production/AiIconAssets'
import type { MobileModel } from '@/types'
import { useTVTheme } from '../theme'

export function ModelIcon({ model, size = 40, inverted = false }: { model: MobileModel | null | undefined; size?: number; inverted?: boolean }) {
  const theme = useTVTheme()
  const dark = inverted ? !theme.isDark : theme.isDark
  const source = aiIconSource(model?.logo ?? model?.lab?.logo, dark, model?.customIcon ?? model?.lab?.customIcon)
  return <Image source={source} style={{ width: size, height: size, borderRadius: size / 4 }} resizeMode="contain" />
}
