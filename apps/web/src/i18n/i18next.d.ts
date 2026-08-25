import 'i18next'
import type enUS from './locales/en-US'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof enUS
    }
  }
}
