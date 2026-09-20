import { UNKNOWN_MODEL_ID } from '@pulpo/contracts'
import { getCatalogModel } from '@/stores/catalog'
import { ModelIcon } from '@/components/ModelIcon'

export function UsageModelIcon({ modelId, logo, className = 'size-4 shrink-0 rounded-[2px]' }: {
  modelId: string
  logo?: string | null
  className?: string
}) {
  const iconModelId = modelId === 'other' ? UNKNOWN_MODEL_ID : modelId
  const catalogModel = getCatalogModel(iconModelId)
  const model = logo ? { ...catalogModel, modelLogo: logo, modelCustomIcon: null } : catalogModel
  return <ModelIcon model={model} className={className} />
}
