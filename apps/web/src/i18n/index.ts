import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US'
import esES from './locales/es-ES'

export const resources = {
  'en-US': { translation: enUS },
  'es-ES': { translation: esES },
} as const

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en-US',
    fallbackLng: 'en-US',
    supportedLngs: ['en-US', 'es-ES'],
    interpolation: { escapeValue: false },
    returnNull: false,
  })

export default i18n
