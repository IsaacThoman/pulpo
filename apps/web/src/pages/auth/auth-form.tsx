import type { ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '@/i18n/useAppTranslation'

/** A form-level error that screen readers announce as soon as it appears. */
export function AuthFormError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </div>
  )
}

/** Show/hide toggle for a password input. It stays in the tab order and exposes its state with aria-pressed. */
export function PasswordVisibilityToggle({ shown, onToggle, controls }: { shown: boolean; onToggle: () => void; controls: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-controls={controls}
      aria-label={t('auth.showPassword')}
      className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </button>
  )
}
