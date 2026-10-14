import { useState } from 'react'
import { FILE_COLORS, FILE_ICONS, type FileColor, type FileIcon, type FileNode } from '@pulpo/contracts'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { setItemAppearance } from '@/features/sidebar/api'
import { ui, uit } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { FILE_COLOR_CLASSES, FILE_ICON_GLYPHS, useAppearanceEditor } from './appearance'
import { FileNodeIcon } from './FileNodeIcon'

function colorLabel(color: FileColor): string {
  switch (color) {
    case 'red': return ui("Red")
    case 'orange': return ui("Orange")
    case 'yellow': return ui("Yellow")
    case 'green': return ui("Green")
    case 'teal': return ui("Teal")
    case 'blue': return ui("Blue")
    case 'purple': return ui("Purple")
    case 'pink': return ui("Pink")
    case 'gray': return ui("Gray")
  }
}

function iconLabel(icon: FileIcon): string {
  switch (icon) {
    case 'star': return ui("Star")
    case 'heart': return ui("Heart")
    case 'bookmark': return ui("Bookmark")
    case 'flag': return ui("Flag")
    case 'book': return ui("Book")
    case 'briefcase': return ui("Briefcase")
    case 'code': return ui("Code")
    case 'music': return ui("Music")
    case 'image': return ui("Image")
    case 'camera': return ui("Camera")
    case 'film': return ui("Film")
    case 'graduation-cap': return ui("Graduation cap")
    case 'home': return ui("Home")
    case 'globe': return ui("Globe")
    case 'lightbulb': return ui("Lightbulb")
    case 'flask': return ui("Flask")
    case 'rocket': return ui("Rocket")
    case 'gamepad': return ui("Game controller")
    case 'shopping-cart': return ui("Shopping cart")
    case 'plane': return ui("Plane")
    case 'wallet': return ui("Wallet")
    case 'calendar': return ui("Calendar")
    case 'lock': return ui("Lock")
    case 'users': return ui("People")
    case 'sparkles': return ui("Sparkles")
    case 'palette': return ui("Palette")
    case 'pen': return ui("Pen")
    case 'wrench': return ui("Wrench")
    case 'leaf': return ui("Leaf")
    case 'coffee': return ui("Coffee")
  }
}

const OPTION = 'grid size-8 cursor-pointer place-items-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:ring-2 aria-pressed:ring-ring'

/** Chooses the color and icon of one or more files and folders; each choice applies at once. */
export function AppearanceDialog() {
  const nodes = useAppearanceEditor((state) => state.nodes)
  const close = () => useAppearanceEditor.setState({ nodes: null })
  return (
    <Dialog open={Boolean(nodes)} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-md">
        {nodes && <AppearancePicker key={nodes.map((node) => node.id).join()} nodes={nodes} onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

/** The value every node shares, or undefined when they differ (then no option shows as chosen). */
function shared<T>(values: readonly T[]): T | undefined {
  return values.every((value) => value === values[0]) ? values[0] : undefined
}

function AppearancePicker({ nodes, onDone }: { nodes: FileNode[]; onDone: () => void }) {
  const [appearance, setAppearance] = useState(() => ({
    color: shared(nodes.map((node) => node.color ?? null)),
    icon: shared(nodes.map((node) => node.icon ?? null)),
  }))
  const choose = (change: { color?: FileColor | null } | { icon?: FileIcon | null }) => {
    setAppearance((current) => ({ ...current, ...change }))
    // Failures are reported in a toast.
    void setItemAppearance(nodes.map((node) => node.id), change)
  }
  const single = nodes.length === 1 ? nodes[0]! : null
  const preview = { ...nodes[0]!, color: appearance.color ?? null, icon: appearance.icon ?? null }
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {single && <FileNodeIcon node={preview} className="size-5" />}
          <span className="truncate">{single ? single.name : uit`${nodes.length} items`}</span>
        </DialogTitle>
        <DialogDescription>{ui("Choose a color and icon.")}</DialogDescription>
      </DialogHeader>
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">{ui("Color")}</h3>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={OPTION} aria-pressed={appearance.color === null} aria-label={ui("Default")} title={ui("Default")} onClick={() => choose({ color: null })}>
            <Ban className="size-4 text-muted-foreground" />
          </button>
          {FILE_COLORS.map((color) => (
            <button key={color} type="button" className={OPTION} aria-pressed={appearance.color === color} aria-label={colorLabel(color)} title={colorLabel(color)} onClick={() => choose({ color })}>
              <span className={cn('size-4 rounded-full', FILE_COLOR_CLASSES[color].swatch)} />
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">{ui("Icon")}</h3>
        <div className="grid grid-cols-8 gap-1">
          <button type="button" className={OPTION} aria-pressed={appearance.icon === null} aria-label={ui("Default")} title={ui("Default")} onClick={() => choose({ icon: null })}>
            <FileNodeIcon node={{ ...preview, icon: null }} className="size-4" />
          </button>
          {FILE_ICONS.map((icon) => {
            const Glyph = FILE_ICON_GLYPHS[icon]
            return (
              <button key={icon} type="button" className={OPTION} aria-pressed={appearance.icon === icon} aria-label={iconLabel(icon)} title={iconLabel(icon)} onClick={() => choose({ icon })}>
                <Glyph className={cn('size-4', appearance.color ? FILE_COLOR_CLASSES[appearance.color].text : 'text-muted-foreground')} />
              </button>
            )
          })}
        </div>
      </section>
      <DialogFooter>
        <Button type="button" onClick={onDone}>{ui("Done")}</Button>
      </DialogFooter>
    </>
  )
}
