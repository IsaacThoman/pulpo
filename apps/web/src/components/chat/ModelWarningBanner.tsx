import { activeModelWarning, dismissModelWarning } from '@pulpo/client-core'
import { findCatalogModel } from '@/lib/catalog-model'
import { useCatalog } from '@/stores/catalog'
import { useSettings } from '@/stores/settings'
import { ModelWarningNotice } from './ModelWarningNotice'

/** Admin-configured notice for the selected model, dismissible per account. */
export function ModelWarningBanner({ modelId }: { modelId: string }) {
  const models = useCatalog((state) => state.models)
  const enabled = useSettings((state) => state.showModelWarnings)
  const dismissals = useSettings((state) => state.modelWarningDismissals)
  const model = findCatalogModel(models, modelId)
  const message = activeModelWarning(model, dismissals, { enabled })
  if (!model || !message) return null
  const dismiss = () => {
    const settings = useSettings.getState()
    settings.set('modelWarningDismissals', dismissModelWarning(settings.modelWarningDismissals, model, models))
  }
  return (
    <div className="px-3 pt-3">
      <ModelWarningNotice message={message} onDismiss={dismiss} />
    </div>
  )
}
