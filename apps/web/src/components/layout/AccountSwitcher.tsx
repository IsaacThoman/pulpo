import { useEffect, useState } from 'react'
import { Check, Loader2, LogOut, UserPlus } from 'lucide-react'
import { MAX_SIGNED_IN_ACCOUNTS, type SignedInAccount } from '@pulpo/contracts'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/stores/auth'
import { ui, uit } from '@/i18n/ui'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function AccountLabel({ account }: { account: SignedInAccount }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{account.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
    </span>
  )
}

/** Loads the signed-in accounts whenever `enabled` turns on. */
function useSignedInAccounts(enabled = true) {
  const accounts = useAuth((state) => state.signedInAccounts)
  const refresh = useAuth((state) => state.refreshSignedInAccounts)
  useEffect(() => {
    if (enabled) void refresh().catch(() => undefined)
  }, [enabled, refresh])
  return accounts
}

/** Other signed-in accounts and "Add account", for the sidebar account menu. */
export function AccountSwitcherMenuItems({ open }: { open: boolean }) {
  const accounts = useSignedInAccounts(open)
  const switchAccount = useAuth((state) => state.switchAccount)
  const addAccount = useAuth((state) => state.addAccount)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const others = accounts.filter((account) => !account.active)
  const atLimit = accounts.length >= MAX_SIGNED_IN_ACCOUNTS

  useEffect(() => { if (!open) setError('') }, [open])

  const run = async (key: string, action: () => Promise<void>, fallback: string) => {
    setPending(key)
    setError('')
    try {
      await action()
    } catch (next) {
      setError(errorMessage(next, fallback))
      setPending(null)
      void useAuth.getState().refreshSignedInAccounts().catch(() => undefined)
    }
  }

  return (
    <>
      {others.map((account) => (
        <DropdownMenuItem
          key={account.id}
          disabled={pending !== null}
          aria-label={uit`Switch to ${account.name}`}
          onSelect={(event) => {
            event.preventDefault()
            void run(account.id, () => switchAccount(account.id), ui('Could not switch accounts.'))
          }}
        >
          <ProfileAvatar name={account.name} avatarUrl={account.avatarUrl} className="size-6" fallbackClassName="text-[10px]" />
          <AccountLabel account={account} />
          {pending === account.id && <Loader2 className="animate-spin" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        disabled={pending !== null || atLimit}
        onSelect={(event) => {
          event.preventDefault()
          void run('add', addAccount, ui('Could not add an account.'))
        }}
      >
        {pending === 'add' ? <Loader2 className="animate-spin" /> : <UserPlus />}
        {atLimit ? uit`Up to ${MAX_SIGNED_IN_ACCOUNTS} accounts` : ui('Add account')}
      </DropdownMenuItem>
      {error && <div role="alert" className="px-2 pb-1.5 text-xs text-destructive">{error}</div>}
      <DropdownMenuSeparator />
    </>
  )
}

/** Signed-in accounts on the sign-in page, so adding an account can be abandoned. */
export function SignedInAccountChooser() {
  const accounts = useSignedInAccounts()
  const switchAccount = useAuth((state) => state.switchAccount)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  if (accounts.length === 0) return null

  const choose = async (userId: string) => {
    setPending(userId)
    setError('')
    try {
      await switchAccount(userId)
    } catch (next) {
      setError(errorMessage(next, ui('Could not switch accounts.')))
      setPending(null)
      void useAuth.getState().refreshSignedInAccounts().catch(() => undefined)
    }
  }

  return (
    <div className="mb-4 rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="mb-2 text-sm font-medium">{ui('Continue as')}</h2>
      <div className="space-y-1">
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            disabled={pending !== null}
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent disabled:cursor-default disabled:opacity-60"
            onClick={() => void choose(account.id)}
          >
            <ProfileAvatar name={account.name} avatarUrl={account.avatarUrl} className="size-8" fallbackClassName="text-[11px]" />
            <AccountLabel account={account} />
            {pending === account.id && <Loader2 className="size-4 animate-spin" />}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** Settings rows for managing every account signed in on this browser or app. */
export function SignedInAccountsSettings({ onClose }: { onClose: () => void }) {
  const accounts = useSignedInAccounts()
  const addAccount = useAuth((state) => state.addAccount)
  const switchAccount = useAuth((state) => state.switchAccount)
  const signOutAccount = useAuth((state) => state.signOutAccount)
  const signOutAllAccounts = useAuth((state) => state.signOutAllAccounts)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const atLimit = accounts.length >= MAX_SIGNED_IN_ACCOUNTS

  const run = async (key: string, action: () => Promise<void>, fallback: string) => {
    setPending(key)
    setError('')
    try {
      await action()
    } catch (next) {
      setError(errorMessage(next, fallback))
      void useAuth.getState().refreshSignedInAccounts().catch(() => undefined)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="py-3">
      <div className="text-sm font-medium">{ui('Signed-in accounts')}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{uit`Stay signed in to up to ${MAX_SIGNED_IN_ACCOUNTS} accounts on this device and switch between them.`}</p>
      <div className="mt-3 space-y-1">
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <ProfileAvatar name={account.name} avatarUrl={account.avatarUrl} className="size-7" fallbackClassName="text-[11px]" />
            <AccountLabel account={account} />
            {account.active
              ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" />{ui('Active')}</span>
              : <>
                <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void run(`switch:${account.id}`, () => switchAccount(account.id), ui('Could not switch accounts.'))}>
                  {pending === `switch:${account.id}` && <Loader2 className="animate-spin" />}{ui('Switch')}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending !== null} aria-label={uit`Sign out ${account.name}`} onClick={() => void run(`sign-out:${account.id}`, () => signOutAccount(account.id), ui('Could not sign out.'))}>
                  {pending === `sign-out:${account.id}` ? <Loader2 className="animate-spin" /> : <LogOut />}
                </Button>
              </>}
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending !== null || atLimit} onClick={() => void run('add', addAccount, ui('Could not add an account.'))}>
          {pending === 'add' ? <Loader2 className="animate-spin" /> : <UserPlus />}{ui('Add account')}
        </Button>
        {accounts.length > 1 && (
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void run('all', async () => { onClose(); await signOutAllAccounts(); window.location.assign('/login') }, ui('Could not sign out.'))}>
            {ui('Sign out of all accounts')}
          </Button>
        )}
      </div>
    </div>
  )
}
