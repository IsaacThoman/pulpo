import { useRef, type ReactNode } from 'react'
import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Baseline,
  Bold,
  ChevronDown,
  Copy,
  EyeOff,
  Group,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListOrdered,
  PaintBucket,
  PanelRight,
  Play,
  Plus,
  Printer,
  Redo2,
  Shapes,
  Strikethrough,
  Table,
  Trash2,
  Type,
  Underline,
  Undo2,
  Ungroup,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToolbarButton } from '@/features/files/editor/ToolbarButton'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { ColorPicker, ShapeGallery, TablePicker } from './pickers'
import { themeColors } from './theme'

const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96]
const FONTS = ['Calibri', 'Calibri Light', 'Aptos', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Segoe UI', 'Century Gothic', 'Garamond']
const LINE_SPACING = [1, 1.15, 1.5, 2, 2.5, 3]

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />
}

function MenuButton({ label, children, icon }: { label: string; children: ReactNode; icon: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onMouseDown={(event) => event.preventDefault()}
          className="flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {icon}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface PresentationToolbarProps {
  controller: PresentationController
  view: 'editor' | 'sorter'
  onViewChange(view: 'editor' | 'sorter'): void
  formatPanel: boolean
  onFormatPanelChange(open: boolean): void
  onPresent(mode: 'start' | 'current' | 'presenter'): void
  onPrint(): void
  printing?: boolean
}

export function PresentationToolbar({ controller, view, onViewChange, formatPanel, onFormatPanelChange, onPresent, onPrint, printing }: PresentationToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const readOnly = controller.readOnly
  const format = controller.formatState()
  const shapes = controller.state.shapes
  const theme = themeColors(controller)
  const layouts = controller.layouts()
  const textDisabled = readOnly || !format.canFormatText
  const insertImage = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const size = await imageSize(file)
    await controller.insertImage(bytes, file.type || 'image/png', size, file.name.replace(/\.[^.]+$/, ''))
  }
  return (
    <div role="toolbar" aria-label={ui("Presentation")} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
      <ToolbarButton label={ui("Undo")} disabled={readOnly || !controller.canUndo()} onClick={() => controller.undo()}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label={ui("Redo")} disabled={readOnly || !controller.canRedo()} onClick={() => controller.redo()}>
        <Redo2 className="size-4" />
      </ToolbarButton>
      <Divider />
      {!readOnly && (
        <>
          <MenuButton label={ui("New slide")} icon={<Plus className="size-4" />}>
            <DropdownMenuLabel>{ui("New slide")}</DropdownMenuLabel>
            {layouts.map((layout) => (
              <DropdownMenuItem key={layout.path} onSelect={() => controller.addSlide(layout.path)}>
                {layout.name || ui("Untitled layout")}
              </DropdownMenuItem>
            ))}
          </MenuButton>
          <ToolbarButton label={ui("Text box")} onClick={() => controller.insertTextBox()}>
            <Type className="size-4" />
          </ToolbarButton>
          <ShapeGallery
            onPick={(preset) => controller.insertShape(preset)}
            trigger={
              <button type="button" aria-label={ui("Shapes")} title={ui("Shapes")} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <Shapes className="size-4" />
              </button>
            }
          />
          <ToolbarButton label={ui("Image")} onClick={() => fileInput.current?.click()}>
            <ImagePlus className="size-4" />
          </ToolbarButton>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
            className="hidden"
            data-testid="presentation-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void insertImage(file)
            }}
          />
          <TablePicker
            onPick={(rows, columns) => controller.insertTable(rows, columns)}
            trigger={
              <button type="button" aria-label={ui("Table")} title={ui("Table")} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <Table className="size-4" />
              </button>
            }
          />
          <Divider />
          <select
            aria-label={ui("Font")}
            title={ui("Font")}
            disabled={textDisabled}
            value={format.fontFamily ?? ''}
            onChange={(event) => controller.setMark('font', event.target.value || undefined)}
            className="h-8 w-32 shrink-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-40"
          >
            <option value="">{ui("Theme font")}</option>
            {[...new Set([...(format.fontFamily ? [format.fontFamily] : []), ...FONTS])].map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </select>
          <select
            aria-label={ui("Font size")}
            title={ui("Font size")}
            disabled={textDisabled}
            value={format.fontSize ?? ''}
            onChange={(event) => controller.setMark('sz', Math.round(Number(event.target.value) * 100))}
            className="h-8 w-16 shrink-0 rounded-md border border-input bg-background px-1 text-sm disabled:opacity-40"
          >
            {format.fontSize === undefined && <option value="">–</option>}
            {[...new Set([...FONT_SIZES, ...(format.fontSize ? [format.fontSize] : [])])].sort((a, b) => a - b).map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <ToolbarButton label={ui("Bold")} shortcut={{ label: '⌘B', aria: 'Meta+B' }} active={format.bold} disabled={textDisabled} onClick={() => controller.toggleMark('b')}>
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Italic")} active={format.italic} disabled={textDisabled} onClick={() => controller.toggleMark('i')}>
            <Italic className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Underline")} active={format.underline} disabled={textDisabled} onClick={() => controller.toggleMark('u')}>
            <Underline className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Strikethrough")} active={format.strike} disabled={textDisabled} onClick={() => controller.toggleMark('strike')}>
            <Strikethrough className="size-4" />
          </ToolbarButton>
          <ColorPicker
            label={ui("Text color")}
            icon={<Baseline className="size-4" />}
            theme={theme}
            disabled={textDisabled}
            onPick={(choice) => controller.setMark('fill', choice.kind === 'fill' ? choice.xml : undefined)}
          />
          <Divider />
          {(
            [
              ['l', ui("Align left"), AlignLeft],
              ['ctr', ui("Center"), AlignCenter],
              ['r', ui("Align right"), AlignRight],
              ['just', ui("Justify"), AlignJustify],
            ] as const
          ).map(([value, label, Icon]) => (
            <ToolbarButton key={value} label={label} active={format.align === value} disabled={textDisabled} onClick={() => controller.setAlign(value)}>
              <Icon className="size-4" />
            </ToolbarButton>
          ))}
          <ToolbarButton label={ui("Bulleted list")} active={format.bullets === 'char'} disabled={textDisabled} onClick={() => controller.setBullets('char')}>
            <List className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Numbered list")} active={format.bullets === 'number'} disabled={textDisabled} onClick={() => controller.setBullets('number')}>
            <ListOrdered className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Decrease list level")} disabled={textDisabled} onClick={() => controller.changeLevel(-1)}>
            <IndentDecrease className="size-4" />
          </ToolbarButton>
          <ToolbarButton label={ui("Increase list level")} disabled={textDisabled} onClick={() => controller.changeLevel(1)}>
            <IndentIncrease className="size-4" />
          </ToolbarButton>
          <MenuButton label={ui("Line spacing")} icon={<AlignHorizontalJustifyCenter className="size-4 rotate-90" />}>
            {LINE_SPACING.map((value) => (
              <DropdownMenuItem key={value} disabled={textDisabled} onSelect={() => controller.setLineSpacing(value)}>
                {value.toFixed(value % 1 ? 2 : 1).replace(/0$/, '')}
              </DropdownMenuItem>
            ))}
          </MenuButton>
          <Divider />
          <ColorPicker
            label={ui("Shape fill")}
            icon={<PaintBucket className="size-4" />}
            theme={theme}
            allowNone
            disabled={!shapes.length}
            onPick={(choice) => controller.setShapeProperty('fill', choice.kind === 'fill' ? choice.xml : '<a:noFill/>')}
          />
          <MenuButton label={ui("Arrange")} icon={<Group className="size-4" />}>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('front')}>
              <ArrowUpToLine className="size-4" /> {ui("Bring to front")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('forward')}>
              {ui("Bring forward")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('backward')}>
              {ui("Send backward")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.reorder('back')}>
              <ArrowDownToLine className="size-4" /> {ui("Send to back")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={shapes.length < 2} onSelect={() => controller.group()}>
              <Group className="size-4" /> {ui("Group")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.ungroup()}>
              <Ungroup className="size-4" /> {ui("Ungroup")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('left')}>{ui("Align left edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('center')}>{ui("Align centers")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('right')}>{ui("Align right edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('top')}>{ui("Align top edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('middle')}>{ui("Align middles")}</DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.align('bottom')}>{ui("Align bottom edges")}</DropdownMenuItem>
            <DropdownMenuItem disabled={shapes.length < 3} onSelect={() => controller.distribute('horizontal')}>{ui("Distribute horizontally")}</DropdownMenuItem>
            <DropdownMenuItem disabled={shapes.length < 3} onSelect={() => controller.distribute('vertical')}>{ui("Distribute vertically")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.duplicateSelection()}>
              <Copy className="size-4" /> {ui("Duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!shapes.length} onSelect={() => controller.deleteSelection()}>
              <Trash2 className="size-4" /> {ui("Delete")}
            </DropdownMenuItem>
          </MenuButton>
          <MenuButton label={ui("Slide")} icon={<LayoutTemplate className="size-4" />}>
            <DropdownMenuLabel>{ui("Layout")}</DropdownMenuLabel>
            {layouts.map((layout) => (
              <DropdownMenuItem key={layout.path} onSelect={() => controller.setLayout(layout.path)}>
                {layout.name || ui("Untitled layout")}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => controller.duplicateSlides()}>{ui("Duplicate slide")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => controller.setSlidesHidden(!controller.slide(controller.state.slide ?? '')?.hidden)}>
              <EyeOff className="size-4" /> {controller.slide(controller.state.slide ?? '')?.hidden ? ui("Show slide") : ui("Hide slide")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={controller.slideKeys().length < 2} onSelect={() => controller.deleteSlides()}>
              <Trash2 className="size-4" /> {ui("Delete slide")}
            </DropdownMenuItem>
          </MenuButton>
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <ToolbarButton label={ui("Slide sorter")} active={view === 'sorter'} onClick={() => onViewChange(view === 'sorter' ? 'editor' : 'sorter')}>
          <LayoutGrid className="size-4" />
        </ToolbarButton>
        {!readOnly && (
          <ToolbarButton label={ui("Format panel")} active={formatPanel} onClick={() => onFormatPanelChange(!formatPanel)}>
            <PanelRight className="size-4" />
          </ToolbarButton>
        )}
        <ToolbarButton label={ui("Export to PDF")} disabled={printing} onClick={onPrint}>
          <Printer className="size-4" />
        </ToolbarButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn('flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90')}>
              <Play className="size-3.5" /> {ui("Present")} <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onPresent('start')}>{ui("From beginning")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPresent('current')}>{ui("From current slide")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPresent('presenter')}>{ui("Presenter view")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function imageSize(file: File): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve(undefined)
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}
