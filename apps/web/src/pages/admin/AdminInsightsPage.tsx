import { useQuery } from '@tanstack/react-query'
import type { InsightsModels } from '@pulpo/contracts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FilterSelect, RangePicker, type FilterOption } from '@/features/admin-analytics/components'
import { useAnalyticsSearch, type AnalyticsSearch } from '@/features/admin-analytics/search-params'
import { ui } from '@/i18n/ui'
import { apiRequest } from '@/lib/api'
import { EngagementSection } from './insights/EngagementSection'
import { FeaturesSection } from './insights/FeaturesSection'
import { ModelsSection } from './insights/ModelsSection'
import { PoolsSection } from './insights/PoolsSection'
import { SettingsSection } from './insights/SettingsSection'
import { ToolsSection } from './insights/ToolsSection'
import { ORIGINS, PLANS, PLATFORMS, originLabel, planLabel, platformLabel } from './insights/labels'

const SECTIONS = ['models', 'settings', 'tools', 'pools', 'features', 'engagement'] as const
type Section = typeof SECTIONS[number]

function sectionLabel(section: Section): string {
  switch (section) {
    case 'models': return ui('Models')
    case 'settings': return ui('Presets & settings')
    case 'tools': return ui('Tools')
    case 'pools': return ui('Pools')
    case 'features': return ui('Platforms & features')
    case 'engagement': return ui('Users & engagement')
  }
}

/** Model filter choices: the models used in the range under every other filter. */
function useModelOptions(search: AnalyticsSearch): FilterOption[] {
  const query = search.query(['platform', 'plan', 'origin'])
  const models = useQuery({
    queryKey: ['admin-analytics', 'insights', 'model-options', query],
    queryFn: () => apiRequest<InsightsModels>(`/api/admin/analytics/insights/models?${query}`),
    placeholderData: (previous) => previous,
  })
  const options = (models.data?.models ?? []).map((model) => ({ value: model.modelId, label: model.modelName }))
  const selected = search.get('model')
  if (selected && !options.some((option) => option.value === selected)) options.push({ value: selected, label: selected })
  return options
}

function InsightsFilters({ search }: { search: AnalyticsSearch }) {
  const modelOptions = useModelOptions(search)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RangePicker search={search} />
      <FilterSelect search={search} name="platform" label={ui('All platforms')} options={PLATFORMS.map((value) => ({ value, label: platformLabel(value) }))} />
      <FilterSelect search={search} name="plan" label={ui('All plans')} options={PLANS.map((value) => ({ value, label: planLabel(value) }))} />
      <FilterSelect search={search} name="origin" label={ui('All origins')} options={ORIGINS.map((value) => ({ value, label: originLabel(value) }))} />
      <FilterSelect search={search} name="model" label={ui('All models')} options={modelOptions} className="w-48" />
    </div>
  )
}

export function AdminInsightsPage() {
  const search = useAnalyticsSearch('30d')
  const rawSection = search.get('section')
  const section: Section = SECTIONS.includes(rawSection as Section) ? rawSection as Section : 'models'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{ui('Insights')}</h2>
          <p className="text-xs text-muted-foreground">{ui('How people use Pulpo: models, settings, tools, pools, platforms and retention.')}</p>
        </div>
      </div>
      <InsightsFilters search={search} />
      <Tabs value={section} onValueChange={(value) => search.update({ section: value === 'models' ? null : value })}>
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {SECTIONS.map((item) => <TabsTrigger key={item} value={item} className="flex-none">{sectionLabel(item)}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="models"><ModelsSection search={search} /></TabsContent>
        <TabsContent value="settings"><SettingsSection search={search} /></TabsContent>
        <TabsContent value="tools"><ToolsSection search={search} /></TabsContent>
        <TabsContent value="pools"><PoolsSection search={search} /></TabsContent>
        <TabsContent value="features"><FeaturesSection search={search} /></TabsContent>
        <TabsContent value="engagement"><EngagementSection search={search} /></TabsContent>
      </Tabs>
    </div>
  )
}
