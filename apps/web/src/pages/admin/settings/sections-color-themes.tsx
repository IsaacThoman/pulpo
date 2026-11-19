import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_COLOR_THEME_ID, instanceColorThemesSnapshotSchema, type CustomTheme } from '@pulpo/contracts'
import { Section } from '@/components/admin/kit'
import { ColorThemePicker } from '@/components/settings/ColorThemeSettings'
import { Button } from '@/components/ui/button'
import { instanceColorThemesQuery } from '@/features/settings/instance-color-themes'
import { ui } from '@/i18n/ui'
import { apiRequest, ApiError } from '@/lib/api'
import { useAuth } from '@/stores/auth'

type CatalogDraft = { themes: CustomTheme[]; revision: string }

export function ColorThemesSection() {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const options = instanceColorThemesQuery(userId)
  const catalog = useQuery(options)
  const [draft, setDraft] = useState<CatalogDraft | null>(null)
  const [selectedId, setSelectedId] = useState(DEFAULT_COLOR_THEME_ID)
  const save = useMutation({
    mutationFn: async (draft: CatalogDraft) => {
      const body = instanceColorThemesSnapshotSchema.parse(draft)
      return instanceColorThemesSnapshotSchema.parse(await apiRequest('/api/admin/settings/color-themes', { method: 'PUT', body }))
    },
    onSuccess: async (saved) => {
      await queryClient.cancelQueries({ queryKey: options.queryKey })
      queryClient.setQueryData(options.queryKey, saved)
      setDraft(null)
    },
  })
  const current = draft ?? catalog.data
  const conflict = Boolean(draft && catalog.data && draft.revision !== catalog.data.revision)
    || (save.error instanceof ApiError && save.error.status === 409)

  return (
    <Section title={ui('Instance color themes')} hint={ui('Publish light and dark palettes that everyone can choose in their appearance settings.')}>
      {current ? (
        <>
          <fieldset disabled={save.isPending}>
            <ColorThemePicker
              scope="instance"
              selectedId={selectedId}
              editableThemes={current.themes}
              onSelect={setSelectedId}
              onEdit={(update) => {
                save.reset()
                setDraft((previous) => {
                  const base = previous ?? current
                  return { ...base, themes: update(base.themes) }
                })
              }}
            />
          </fieldset>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            {draft && (
              <Button type="button" variant="ghost" size="sm" disabled={save.isPending || catalog.isFetching} onClick={async () => {
                const refreshed = await catalog.refetch()
                if (!refreshed.isSuccess) return
                save.reset()
                setDraft(null)
              }}>
                {ui('Discard changes')}
              </Button>
            )}
            <Button type="button" size="sm" disabled={!draft || save.isPending || conflict} onClick={() => draft && save.mutate(draft)}>
              {save.isPending ? ui('Publishing…') : ui('Publish themes')}
            </Button>
          </div>
          {save.isSuccess && <p role="status" className="text-sm text-muted-foreground">{ui('Instance themes published.')}</p>}
          {(conflict || save.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {conflict
                ? ui('Instance themes changed while you were editing. Discard your changes to load the latest catalog.')
                : ui('Could not publish instance themes. Try again.')}
            </p>
          )}
        </>
      ) : catalog.isError ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">{ui('Could not load instance themes.')}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void catalog.refetch()}>{ui('Retry')}</Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{ui('Loading instance themes…')}</p>
      )}
    </Section>
  )
}
