import type { FunctionDoc, SheetView } from '@pulpo/client-core/office/sheets/view'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { ui } from '@/i18n/ui'
import { COMMON_FUNCTIONS, commonFunctionLabel, functionCategoryLabel, functionGroups, insertFunction, runCommonFunction } from './functions'

/** One function row: its name, with its description as a tooltip. */
function FunctionItem({ doc, onPick }: { doc: FunctionDoc; onPick: (name: string) => void }) {
  return (
    <DropdownMenuItem title={doc.description} onSelect={() => onPick(doc.name)} data-function={doc.name} className="font-mono text-xs">
      {doc.name}
    </DropdownMenuItem>
  )
}

/** The library's groups as submenus of functions, scrolling when long (Insert ▸ Function, Σ, fx). */
export function FunctionCategorySubmenus({ functions, onPick }: { functions: readonly FunctionDoc[]; onPick: (name: string) => void }) {
  return functionGroups(functions).map((group) => (
    <DropdownMenuSub key={group.category}>
      <DropdownMenuSubTrigger data-menu-item={`function-category-${group.category}`}>
        {functionCategoryLabel(group.category)}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] max-w-(--radix-dropdown-menu-content-available-width) min-w-[min(10rem,var(--radix-dropdown-menu-content-available-width))] overflow-y-auto">
        {group.functions.map((doc) => <FunctionItem key={doc.name} doc={doc} onPick={onPick} />)}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  ))
}

/** Every function by group, picked into the active cell (Insert ▸ Function and More functions ▸). */
export function AllFunctions({ view }: { view: SheetView }) {
  return <FunctionCategorySubmenus functions={view.functions} onPick={(name) => insertFunction(view, name)} />
}

/**
 * The Σ (toolbar) and fx (formula bar) menus, as Excel's AutoSum list: the common functions, which
 * total a selected range, then More functions ▸ with every function by group.
 */
export function FunctionMenuItems({ view }: { view: SheetView }) {
  return (
    <>
      {COMMON_FUNCTIONS.map((name) => (
        <DropdownMenuItem key={name} onSelect={() => runCommonFunction(view, name)} data-function={name}>
          {commonFunctionLabel(name)}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-menu-item="more-functions">{ui("More functions")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-w-(--radix-dropdown-menu-content-available-width)">
          <AllFunctions view={view} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
