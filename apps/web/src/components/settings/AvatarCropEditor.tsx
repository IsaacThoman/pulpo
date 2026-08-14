import { useEffect, useRef, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { avatarDrawRect, type AvatarCropSettings } from './avatar-crop'

export function AvatarCropEditor({
  imageUrl,
  settings,
  onChange,
}: {
  imageUrl: string
  settings: AvatarCropSettings
  onChange: (settings: AvatarCropSettings) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      imageRef.current = image
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.src = imageUrl
    return () => { if (imageRef.current === image) imageRef.current = null }
  }, [imageUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image || !imageSize.width) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, 512, 512)
    const rect = avatarDrawRect(imageSize.width, imageSize.height, settings)
    if (settings.cropToCircle) {
      context.save()
      context.beginPath()
      context.arc(256, 256, 256, 0, Math.PI * 2)
      context.clip()
    }
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
    if (settings.cropToCircle) context.restore()
  }, [imageSize, settings])

  const moveCrop = (clientX: number, clientY: number) => {
    const drag = dragRef.current
    const canvas = canvasRef.current
    if (!drag || !canvas || !imageSize.width) return
    const bounds = canvas.getBoundingClientRect()
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
      <canvas
        ref={canvasRef}
        width={512}
        height={512}
        aria-label={settings.cropToCircle ? 'Circular profile picture crop preview' : 'Full profile picture preview'}
        className={cn(
          'size-32 shrink-0 border bg-muted/40 object-contain',
          settings.cropToCircle ? 'cursor-grab touch-none rounded-full active:cursor-grabbing' : 'rounded-lg',
        )}
        onPointerDown={(event) => {
          if (!settings.cropToCircle) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, y: event.clientY, offsetX: settings.offsetX, offsetY: settings.offsetY }
        }}
        onPointerMove={(event) => moveCrop(event.clientX, event.clientY)}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          dragRef.current = null
        }}
        onPointerCancel={() => { dragRef.current = null }}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <div className="text-sm font-medium">Profile picture preview</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {settings.cropToCircle ? 'Drag to reposition, then adjust the zoom.' : 'The full image will be resized without cropping.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="crop-avatar-circle"
            checked={settings.cropToCircle}
            onCheckedChange={(cropToCircle) => onChange({ ...settings, cropToCircle, zoom: 1, offsetX: 0, offsetY: 0 })}
          />
          <Label htmlFor="crop-avatar-circle" className="text-xs">Crop to circle</Label>
        </div>
        {settings.cropToCircle && <div className="flex items-center gap-3">
          <Label htmlFor="avatar-crop-zoom" className="text-xs text-muted-foreground">Zoom</Label>
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
