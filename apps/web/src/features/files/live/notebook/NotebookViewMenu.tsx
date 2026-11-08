import type { NotebookController } from '@pulpo/client-core/office/notebook/view'
import { SlidersHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'

/**
 * How the notebook shows (JupyterLab's View menu): line numbers and wrapping, which are this
 * person's preference, and collapsing or expanding every cell's code or outputs, which the
 * notebook records (JupyterLab and VS Code read it), each one undo step.
 */
export function NotebookViewMenu({ controller, canEdit, lineNumbers, onLineNumbers, wrap, onWrap, focusNotebook }: {
  controller: NotebookController
  canEdit: boolean
  lineNumbers: boolean
  onLineNumbers: (on: boolean) => void
  wrap: boolean
  onWrap: (on: boolean) => void
  focusNotebook: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ui("View options")}
          title={ui("View options")}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          // Keys go on working in the notebook, not on this button.
          event.preventDefault()
          focusNotebook()
        }}
      >
        <DropdownMenuCheckboxItem checked={lineNumbers} onCheckedChange={onLineNumbers}>
          {ui("Line numbers")}
          <DropdownMenuShortcut>{'Shift+L'}</DropdownMenuShortcut>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={onWrap}>{ui("Wrap long lines")}</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canEdit} onSelect={() => controller.setAllCollapsed('source', true)}>{ui("Collapse all code")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!canEdit} onSelect={() => controller.setAllCollapsed('source', false)}>{ui("Expand all code")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!canEdit} onSelect={() => controller.setAllCollapsed('outputs', true)}>{ui("Collapse all outputs")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!canEdit} onSelect={() => controller.setAllCollapsed('outputs', false)}>{ui("Expand all outputs")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
