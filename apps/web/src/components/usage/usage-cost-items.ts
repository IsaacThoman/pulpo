import type { UsageCostItem } from '@pulpo/contracts'
import { formatUsd } from '@/lib/format'
import { activeLocale, ui, uit } from '@/i18n/ui'

export interface UsageCostLine {
  amount: string
  label: string
}

function toolLabel(name: string | undefined, n: string, one: boolean): string {
  switch (name) {
    case 'web_search': return one ? uit`${n} web search` : uit`${n} web searches`
    case 'web_fetch': return one ? uit`${n} web fetch` : uit`${n} web fetches`
    case 'generate_image': return one ? uit`${n} image generated` : uit`${n} images generated`
    default: return one ? uit`${n} ${name ?? ''} call` : uit`${n} ${name ?? ''} calls`
  }
}

function taskLabel(name: string | undefined, n: string, one: boolean): string {
  switch (name) {
    case 'compaction': return one ? uit`${n} context compaction` : uit`${n} context compactions`
    case 'ocr': return one ? uit`${n} image text extraction` : uit`${n} image text extractions`
    case 'title': return one ? uit`${n} chat title` : uit`${n} chat titles`
    case 'memory': return one ? uit`${n} memory update` : uit`${n} memory updates`
    default: return one ? uit`${n} ${name ?? ''} task` : uit`${n} ${name ?? ''} tasks`
  }
}

function itemLabel(item: UsageCostItem): string {
  const n = item.quantity.toLocaleString(activeLocale())
  const one = item.quantity === 1
  switch (item.kind) {
    case 'model': return item.quantity > 0 ? one ? uit`${n} model token` : uit`${n} model tokens` : ui('Model usage')
    case 'tool': return toolLabel(item.name, n, one)
    case 'task': return taskLabel(item.name, n, one)
    case 'workspace': return one ? uit`${n} workspace minute` : uit`${n} workspace minutes`
    case 'waived': return ui('Not charged · exceeded available funds')
  }
}

/** Charged lines of a usage event's itemized cost, in settlement order. */
export function usageCostLines(items: readonly UsageCostItem[] | null | undefined): UsageCostLine[] {
  return (items ?? [])
    .filter((item) => item.costMicros !== 0)
    .map((item) => ({ amount: formatUsd(item.costMicros / 1_000_000), label: itemLabel(item) }))
}
