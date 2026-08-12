import type { ImageSourcePropType } from 'react-native'
import { apiUrl } from '../../../api/client'
import type { MobileCatalogIcon } from '../../../types'

const light: Record<string, ImageSourcePropType> = {
  alibaba: require('../../assets/ai-icons/qwen.png'),
  anthropic: require('../../assets/ai-icons/anthropic.png'),
  claude: require('../../assets/ai-icons/claude.png'),
  'claude-color': require('../../assets/ai-icons/claude-color.png'),
  deepseek: require('../../assets/ai-icons/deepseek.png'),
  'deepseek-color': require('../../assets/ai-icons/deepseek-color.png'),
  gemini: require('../../assets/ai-icons/gemini.png'),
  'gemini-color': require('../../assets/ai-icons/gemini-color.png'),
  google: require('../../assets/ai-icons/google.png'),
  'google-color': require('../../assets/ai-icons/google-color.png'),
  grok: require('../../assets/ai-icons/grok.png'),
  meta: require('../../assets/ai-icons/meta.png'),
  'meta-color': require('../../assets/ai-icons/meta-color.png'),
  minimax: require('../../assets/ai-icons/minimax.png'),
  'minimax-color': require('../../assets/ai-icons/minimax-color.png'),
  mistral: require('../../assets/ai-icons/mistral.png'),
  'mistral-color': require('../../assets/ai-icons/mistral-color.png'),
  moonshot: require('../../assets/ai-icons/moonshot.png'),
  openai: require('../../assets/ai-icons/openai.png'),
  qwen: require('../../assets/ai-icons/qwen.png'),
  'qwen-color': require('../../assets/ai-icons/qwen-color.png'),
  xai: require('../../assets/ai-icons/xai.png'),
  zhipu: require('../../assets/ai-icons/zhipu.png'),
  'zhipu-color': require('../../assets/ai-icons/zhipu-color.png'),
  pulpo: require('../../assets/pulpo-smiley.png'),
}

const dark: Record<string, ImageSourcePropType> = {
  alibaba: require('../../assets/ai-icons/qwen-dark.png'),
  anthropic: require('../../assets/ai-icons/anthropic-dark.png'),
  claude: require('../../assets/ai-icons/claude-dark.png'),
  'claude-color': require('../../assets/ai-icons/claude-color-dark.png'),
  deepseek: require('../../assets/ai-icons/deepseek-dark.png'),
  'deepseek-color': require('../../assets/ai-icons/deepseek-color-dark.png'),
  gemini: require('../../assets/ai-icons/gemini-dark.png'),
  'gemini-color': require('../../assets/ai-icons/gemini-color-dark.png'),
  google: require('../../assets/ai-icons/google-dark.png'),
  'google-color': require('../../assets/ai-icons/google-color-dark.png'),
  grok: require('../../assets/ai-icons/grok-dark.png'),
  meta: require('../../assets/ai-icons/meta-dark.png'),
  'meta-color': require('../../assets/ai-icons/meta-color-dark.png'),
  minimax: require('../../assets/ai-icons/minimax-dark.png'),
  'minimax-color': require('../../assets/ai-icons/minimax-color-dark.png'),
  mistral: require('../../assets/ai-icons/mistral-dark.png'),
  'mistral-color': require('../../assets/ai-icons/mistral-color-dark.png'),
  moonshot: require('../../assets/ai-icons/moonshot-dark.png'),
  openai: require('../../assets/ai-icons/openai-dark.png'),
  qwen: require('../../assets/ai-icons/qwen-dark.png'),
  'qwen-color': require('../../assets/ai-icons/qwen-color-dark.png'),
  xai: require('../../assets/ai-icons/xai-dark.png'),
  zhipu: require('../../assets/ai-icons/zhipu-dark.png'),
  'zhipu-color': require('../../assets/ai-icons/zhipu-color-dark.png'),
  pulpo: require('../../assets/pulpo-smiley.png'),
}

export function aiIconSource(id: string | null | undefined, isDark: boolean, customIcon?: MobileCatalogIcon | null): ImageSourcePropType {
  if (customIcon) return { uri: apiUrl(isDark ? customIcon.darkUrl : customIcon.lightUrl) }
  const catalog = isDark ? dark : light
  return catalog[id ?? 'pulpo'] ?? catalog.pulpo
}
