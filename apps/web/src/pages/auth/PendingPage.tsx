import { useRef, useState } from 'react'
import { useTranslation } from '@/i18n/useAppTranslation'
import { Navigate, useNavigate } from 'react-router-dom'
import { LogOut, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ApiError, apiRequest } from '@/lib/api'
import { useAuth, type AuthUser } from '@/stores/auth'

const INVITE_CODE_LENGTH = 6

function cleanInviteCode(value: string): string[] {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, INVITE_CODE_LENGTH).split('')
}

export function PendingPage() {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const replaceUser = useAuth((s) => s.replaceUser)
  const pendingDetails = useAuth((s) => s.pendingDetails)
  const adminEmail = useAuth((s) => s.adminEmail)
  const pendingMessage = useAuth((s) => s.pendingMessage)
  const inviteCodesEnabled = useAuth((s) => s.inviteCodesEnabled)
  const navigate = useNavigate()
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const [codeCharacters, setCodeCharacters] = useState<string[]>(() => Array(INVITE_CODE_LENGTH).fill(''))
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')

  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'pending') return <Navigate to="/" replace />

  const code = codeCharacters.join('')

  const focusCodeInput = (index: number) => {
    const input = codeInputRefs.current[index]
    input?.focus()
    input?.select()
  }

  const enterCodeCharacters = (index: number, value: string) => {
    const characters = cleanInviteCode(value)
    if (characters.length === 0) {
      setCodeCharacters((current) => current.map((character, characterIndex) => characterIndex === index ? '' : character))
      return
    }

    const startIndex = characters.length === INVITE_CODE_LENGTH ? 0 : index
    setCodeCharacters((current) => {
      const next = [...current]
      characters.forEach((character, offset) => {
        if (startIndex + offset < INVITE_CODE_LENGTH) next[startIndex + offset] = character
      })
      return next
    })
    setRedeemError('')
    focusCodeInput(Math.min(startIndex + characters.length, INVITE_CODE_LENGTH - 1))
  }

  const handleCodeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusCodeInput(Math.max(0, index - 1))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusCodeInput(Math.min(INVITE_CODE_LENGTH - 1, index + 1))
      return
    }
    if (event.key !== 'Backspace') return

    event.preventDefault()
    const removeIndex = codeCharacters[index] ? index : Math.max(0, index - 1)
    setCodeCharacters((current) => current.map((character, characterIndex) => characterIndex === removeIndex ? '' : character))
    setRedeemError('')
    focusCodeInput(removeIndex)
  }

  const redeem = async () => {
    setRedeeming(true)
    setRedeemError('')
    try {
      const result = await apiRequest<{ user: Omit<AuthUser, 'initials'> }>('/api/invite-codes/redeem', {
        method: 'POST',
        body: { code },
      })
      replaceUser(result.user)
      navigate('/', { replace: true })
    } catch (error) {
      setRedeemError(error instanceof ApiError ? error.message : t('auth.redeemFailed'))
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <img src="/pulpo-smiley.png" alt="Pulpo" className="size-10" />
        <span className="text-xl font-semibold tracking-tight">Pulpo</span>
      </div>

      <div className="w-full max-w-[440px] rounded-xl border bg-card p-6 shadow-xs sm:p-8">
        <h1 className="text-lg font-semibold">{t('auth.accountPending')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pendingMessage}</p>

        {inviteCodesEnabled && (
          <form
            className="mt-7 space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void redeem()
            }}
          >
            <div className="space-y-3">
              <label htmlFor="invite-code-0" className="text-sm font-medium">{t('auth.inviteCode')}</label>
              <div className="grid grid-cols-6 gap-3" role="group" aria-label={t('auth.inviteCodeLabel')}>
                {codeCharacters.map((character, index) => (
                  <Input
                    key={index}
                    id={`invite-code-${index}`}
                    ref={(input) => { codeInputRefs.current[index] = input }}
                    value={character}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => enterCodeCharacters(index, event.target.value)}
                    onPaste={(event) => {
                      event.preventDefault()
                      enterCodeCharacters(index, event.clipboardData.getData('text'))
                    }}
                    onKeyDown={(event) => handleCodeKeyDown(event, index)}
                    className="aspect-square h-auto px-0 text-center font-mono text-xl font-medium uppercase md:text-xl"
                    maxLength={1}
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={redeeming}
                    aria-invalid={Boolean(redeemError)}
                    aria-label={t('auth.inviteCodeCharacter', { number: index + 1 })}
                    aria-describedby={redeemError ? 'invite-code-error' : undefined}
                  />
                ))}
              </div>
              {redeemError && <p id="invite-code-error" className="text-sm text-destructive">{redeemError}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={redeeming || code.length !== 6}>
              {redeeming ? t('auth.redeeming') : t('auth.redeemInvite')}
            </Button>
          </form>
        )}

        {pendingDetails && adminEmail && (
          <div className="mt-5 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-start gap-2.5 text-sm">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-medium">{t('auth.needHelp')}</div>
                <p className="mt-0.5 text-muted-foreground">
                  {t('auth.contactAdmin')}{' '}
                  <a
                    href={`mailto:${adminEmail}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {adminEmail}
                  </a>
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            <LogOut />
            {t('auth.signOut')}
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            {t('auth.refreshStatus')}
          </Button>
        </div>
      </div>
    </div>
  )
}
