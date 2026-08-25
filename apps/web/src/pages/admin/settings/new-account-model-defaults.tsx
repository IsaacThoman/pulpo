import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { NewAccountModelDefaults } from '@pulpo/contracts'
import { Button } from '@/components/ui/button'
import { Section, SelectField } from '@/components/admin/kit'
import { modelOptionLabel, type AvailableModel } from './use-available-models'
import {
  ADD_MODEL_VALUE,
  addFavoriteModel,
  AUTOMATIC_MODEL_VALUE,
  defaultModelOptions,
  moveFavoriteModel,
  removeFavoriteModel,
  withDefaultModel,
} from './new-account-model-defaults-logic'
import { ui, uit } from '@/i18n/ui'

function favoriteLabel(models: AvailableModel[], modelId: string): string {
  const model = models.find((candidate) => candidate.id === modelId)
  return model ? modelOptionLabel(model) : `Unavailable (${modelId})`
}

export function NewAccountModelDefaultsFields({
  value,
  models,
  onChange,
}: {
  value: NewAccountModelDefaults
  models: AvailableModel[]
  onChange: (value: NewAccountModelDefaults) => void
}) {
  const availableToAdd = models.filter((model) => !value.favoriteModelIds.includes(model.id))
  const addOptions = [
    {
      value: ADD_MODEL_VALUE,
      label: availableToAdd.length ? 'Choose a model…' : 'All available models added',
    },
    ...availableToAdd.map((model) => ({ value: model.id, label: modelOptionLabel(model) })),
  ]

  return (
    <Section
      title={ui("New account models")}
      hint="Copied into each new account. Existing accounts keep their own model preferences."
    >
      <SelectField
        label={ui("Default model")}
        hint="Automatic uses the first available model. The default does not need to be a favorite."
        value={value.defaultModelId ?? AUTOMATIC_MODEL_VALUE}
        onChange={(modelId) => onChange(withDefaultModel(
          value,
          modelId === AUTOMATIC_MODEL_VALUE ? null : modelId,
        ))}
        options={defaultModelOptions(models, value.defaultModelId)}
      />
      <SelectField
        label={ui("Add favorite model")}
        hint="Favorites appear in the order shown below."
        value={ADD_MODEL_VALUE}
        onChange={(modelId) => {
          if (modelId === ADD_MODEL_VALUE) return
          onChange({ ...value, favoriteModelIds: addFavoriteModel(value.favoriteModelIds, modelId) })
        }}
        options={addOptions}
      />
      <div>
        <div className="mb-2 text-sm">{ui("Favorite model order")}</div>
        {value.favoriteModelIds.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground"> {ui("New accounts will start without favorite models.")} </div>
        ) : (
          <div className="space-y-1.5">
            {value.favoriteModelIds.map((modelId, index) => {
              const label = favoriteLabel(models, modelId)
              return (
                <div key={modelId} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    aria-label={uit`Move ${label} up`}
                    onClick={() => onChange({
                      ...value,
                      favoriteModelIds: moveFavoriteModel(value.favoriteModelIds, index, -1),
                    })}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === value.favoriteModelIds.length - 1}
                    aria-label={uit`Move ${label} down`}
                    onClick={() => onChange({
                      ...value,
                      favoriteModelIds: moveFavoriteModel(value.favoriteModelIds, index, 1),
                    })}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={uit`Remove ${label}`}
                    onClick={() => onChange({
                      ...value,
                      favoriteModelIds: removeFavoriteModel(value.favoriteModelIds, modelId),
                    })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Section>
  )
}
