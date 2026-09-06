import { useRef, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { avatarDrawRect, type AvatarCropSettings } from './avatar-crop'
import { ui } from '@/i18n/ui'

export function AvatarCropEditor({
  imageUrl,
  settings,
  onChange,
}: {
  imageUrl: string
  settings: AvatarCropSettings
  onChange: (settings: AvatarCropSettings) => void
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })

  const rect = imageSize.width ? avatarDrawRect(imageSize.width, imageSize.height, settings) : null

  const moveCrop = (clientX: number, clientY: number) => {
    const drag = dragRef.current
    const preview = previewRef.current
    if (!settings.cropToCircle || !drag || !preview || !imageSize.width) return
    const bounds = preview.getBoundingClientRect()
    const proposed = {
      ...settings,
      offsetX: drag.offsetX + (clientX - drag.x) * (512 / bounds.width),
      offsetY: drag.offsetY + (clientY - drag.y) * (512 / bounds.height),
    }
    const rect = avatarDrawRect(imageSize.width, imageSize.height, proposed)
    onChange({
      ...proposed,
      offsetX: rect.x - (512 - rect.width) / 2,
      offsetY: rect.y - (512 - rect.height) / 2,
    })
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div
        ref={previewRef}
        role="img"
        aria-label={settings.cropToCircle ? ui("Circular profile picture crop preview") : ui("Full profile picture preview")}
        className={cn(
          'relative size-32 shrink-0 overflow-hidden bg-muted/40 ring-1 ring-border',
          settings.cropToCircle ? 'cursor-grab touch-none rounded-full active:cursor-grabbing' : 'rounded-none',
        )}
        onPointerDown={(event) => {
          if (!settings.cropToCircle) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, y: event.clientY, offsetX: settings.offsetX, offsetY: settings.offsetY }
        }}
        onPointerMove={(event) => moveCrop(event.clientX, event.clientY)}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          dragRef.current = null
        }}
        onPointerCancel={() => { dragRef.current = null }}
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          className="pointer-events-none absolute max-w-none select-none"
          style={rect ? { left: `${rect.x / 512 * 100}%`, top: `${rect.y / 512 * 100}%`, width: `${rect.width / 512 * 100}%`, height: `${rect.height / 512 * 100}%` } : { visibility: 'hidden' }}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <div className="text-sm font-medium">{ui("Profile picture preview")}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {settings.cropToCircle ? ui("Drag to reposition, then adjust the zoom.") : ui("The full image will be resized without cropping.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="crop-avatar-circle"
            checked={settings.cropToCircle}
            onCheckedChange={(cropToCircle) => onChange({ ...settings, cropToCircle, zoom: 1, offsetX: 0, offsetY: 0 })}
          />
          <Label htmlFor="crop-avatar-circle" className="text-xs">{ui("Crop to circle")}</Label>
        </div>
        {settings.cropToCircle && <div className="flex items-center gap-3">
          <Label htmlFor="avatar-crop-zoom" className="text-xs text-muted-foreground">{ui("Zoom")}</Label>
          <Slider
            id="avatar-crop-zoom"
            value={[settings.zoom]}
            min={1}
            max={3}
            step={0.01}
            className="max-w-48"
            onValueChange={([zoom]) => onChange({ ...settings, zoom: zoom ?? 1 })}
          />
        </div>}
      </div>
    </div>
  )
}
