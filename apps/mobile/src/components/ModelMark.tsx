import { Image, StyleSheet, Text, View } from 'react-native'
import type { MobileModel } from '../types'
import { useAppTheme } from '../theme'

function imageFor(model: Pick<MobileModel, 'name' | 'provider'>) {
  const value = `${model.provider.name} ${model.name}`.toLowerCase()
  if (value.includes('anthropic') || value.includes('claude')) return require('../../assets/model-claude.png')
  if (value.includes('gemini') || value.includes('google')) return require('../../assets/model-gemini.png')
  if (value.includes('deepseek')) return require('../../assets/model-deepseek.png')
  return require('../../assets/model-openai.png')
}

export function ModelMark({ model, size = 28 }: { model?: MobileModel; size?: number }) {
  const theme = useAppTheme()
  if (!model) return <View style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: theme.fillStrong }]}><Text style={{ color: theme.text, fontSize: size * 0.38, fontWeight: '800' }}>P</Text></View>
  return <Image source={imageFor(model)} style={{ width: size, height: size, borderRadius: size * 0.22 }} resizeMode="contain" />
}

const styles = StyleSheet.create({ fallback: { alignItems: 'center', justifyContent: 'center' } })
