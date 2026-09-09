import { useQuery } from '@tanstack/react-query'
import { imagePriceLabel, type PublicImageModel } from '@pulpo/contracts'
import { useSettings } from '@/stores/settings'
import { useAuth } from '@/stores/auth'
import { apiRequest } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'

export function ImageGenerationSettings() {
  const preferences = useSettings(s => s.imageGeneration)
  const set = useSettings(s => s.set)
  const userId = useAuth(s => s.user?.id)
  const catalog = useQuery({ queryKey: ['image-models', userId], queryFn: () => apiRequest<{ data: PublicImageModel[] }>('/api/image-models') })
  const model = catalog.data?.data.find(entry => entry.id === preferences.modelId)
  return <div className="space-y-5">
    <div><h3 className="text-sm font-semibold">{ui('Image generation')}</h3><p className="mt-1 text-sm text-muted-foreground">{ui('Let the agent generate and edit images in your conversations. Agent mode must be enabled.')}</p></div>
    <div className="flex items-center justify-between gap-4"><label htmlFor="image-generation-enabled" className="text-sm font-medium">{ui('Enable image generation')}</label><Switch id="image-generation-enabled" checked={preferences.enabled} disabled={!model && !preferences.enabled} onCheckedChange={enabled => set('imageGeneration', { ...preferences, enabled })} /></div>
    <div className="space-y-2"><label id="image-model-label" className="text-sm font-medium">{ui('Image model')}</label>
      <Select value={model?.id ?? ''} onValueChange={modelId => set('imageGeneration', { ...preferences, modelId })}>
        <SelectTrigger aria-labelledby="image-model-label" className="w-full"><SelectValue placeholder={ui(catalog.isLoading ? 'Loading models…' : preferences.modelId ? 'Selected model unavailable' : 'Choose a model')} /></SelectTrigger>
        <SelectContent>{catalog.data?.data.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
      </Select>
      {model && <p className="text-xs text-muted-foreground">{ui(imagePriceLabel(model))}</p>}
    </div>
    {catalog.isError && <div role="alert"><p className="text-sm text-destructive">{ui('Image models could not be loaded.')}</p><Button variant="ghost" onClick={() => void catalog.refetch()}>{ui('Retry')}</Button></div>}
    {catalog.data?.data.length === 0 && <p className="text-sm text-muted-foreground">{ui('An admin must configure an image model first.')}</p>}
    {preferences.modelId && !model && catalog.isSuccess && <p className="text-sm text-muted-foreground">{ui('Your selected image model is unavailable. Choose another model to generate images.')}</p>}
  </div>
}
