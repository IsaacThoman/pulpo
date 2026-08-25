import { useEffect } from 'react'
import i18n from './index'
import { useSettings } from '@/stores/settings'

export function I18nBridge() {
  const language = useSettings((state) => state.language)

  useEffect(() => {
    void i18n.changeLanguage(language)
  }, [language])

  return null
}
