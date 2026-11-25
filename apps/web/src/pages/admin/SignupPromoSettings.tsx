import {
  SIGNUP_PROMO_CLAIM_DAYS,
  SIGNUP_PROMO_MAX_CENTS,
  SIGNUP_PROMO_MESSAGE_MAX,
  signupPromoConfigSchema,
  type SignupPromoAdminSettings,
  type SignupPromoConfig,
} from '@pulpo/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { formatBalance } from '@/lib/format'

const endpoint = '/api/admin/billing/signup-promo'
const queryKey = ['admin-billing-signup-promo']

type Draft = { enabled: boolean; amount: string; dailyCap: string; message: string }

export function SignupPromoSettings() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>()
  const settings = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAdminSettings>(endpoint, { signal }),
    refetchInterval: 30_000,
  })
  const save = useMutation({
    mutationFn: (body: SignupPromoConfig) => apiRequest<SignupPromoAdminSettings>(endpoint, { method: 'PUT', body }),
    onSuccess: async (saved) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData(queryKey, saved)
      setDraft(undefined)
      void queryClient.invalidateQueries({ queryKey: ['signup-promo'] })
    },
  })
  if (!settings.data) {
    return <p role={settings.isError ? 'alert' : 'status'} className="p-3 text-xs text-muted-foreground">
      {settings.isError ? ui("Could not load signup promotion settings.") : ui("Loading…")}
    </p>
  }

  const current = draft ?? {
    enabled: settings.data.enabled,
    amount: (settings.data.amountCents / 100).toFixed(2),
    dailyCap: (settings.data.dailyCapCents / 100).toFixed(2),
    message: settings.data.message,
  }
  const input = signupPromoConfigSchema.safeParse({
    enabled: current.enabled,
    amountCents: Math.round(Number(current.amount) * 100),
    dailyCapCents: Math.round(Number(current.dailyCap) * 100),
    message: current.message,
  })
  function edit(change: Partial<Draft>) {
    save.reset()
    setDraft({ ...current, ...change })
  }

  return (
    <form className="space-y-3 p-3" onSubmit={(event) => {
      event.preventDefault()
      if (input.success && !save.isPending) save.mutate(input.data)
    }}>
      <p className="text-xs text-muted-foreground">
        {ui("Approved accounts created while the promotion is active can claim once within {{days}} days of signup. Re-enabling the promotion starts a new signup window.", { days: SIGNUP_PROMO_CLAIM_DAYS })}
      </p>
      <fieldset disabled={save.isPending} className="space-y-3">
        <label className="flex w-fit items-center gap-2 text-xs">
          <Switch checked={current.enabled} onCheckedChange={(enabled) => edit({ enabled })} />
          {ui("Enable signup promotion")}
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-xs">
            <span>{ui("Credit per claim (USD)")}</span>
            <Input type="number" min="0.01" max={SIGNUP_PROMO_MAX_CENTS / 100} step="0.01" required value={current.amount}
              onChange={(event) => edit({ amount: event.target.value })} className="h-8 w-32 text-xs" />
          </label>
          <label className="space-y-1 text-xs">
            <span>{ui("Instance daily cap (USD)")}</span>
            <Input type="number" min="0.01" max={SIGNUP_PROMO_MAX_CENTS / 100} step="0.01" required value={current.dailyCap}
              onChange={(event) => edit({ dailyCap: event.target.value })} className="h-8 w-32 text-xs" />
          </label>
        </div>
        <label className="block max-w-xl space-y-1 text-xs">
          <span>{ui("Banner message (optional)")}</span>
          <Textarea rows={2} maxLength={SIGNUP_PROMO_MESSAGE_MAX} value={current.message}
            placeholder={ui("A little something to get you started.")}
            onChange={(event) => edit({ message: event.target.value })} className="text-xs" />
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!draft || !input.success || save.isPending}>
          {save.isPending ? ui("Saving…") : ui("Save")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {ui("{{claimed}} of {{cap}} claimed today. Resets at midnight UTC.", {
            claimed: formatBalance(settings.data.claimedTodayCents / 100),
            cap: formatBalance(settings.data.dailyCapCents / 100),
          })}
        </p>
        {!input.success && <p role="status" className="text-xs text-destructive">{ui("Enter a positive credit amount and a daily cap that covers at least one claim.")}</p>}
        {save.isError && <p role="alert" className="text-xs text-destructive">{ui("Could not save the signup promotion.")}</p>}
        {save.isSuccess && <p role="status" className="text-xs text-muted-foreground">{ui("Signup promotion saved.")}</p>}
      </div>
    </form>
  )
}
