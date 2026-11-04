import { FILE_COLORS, FILE_ICONS, type FileColor, type FileIcon, type FileNode } from '@pulpo/contracts'
import { isTrashFolder } from '../trash/folder'

/*
 * A file's or folder's color and icon, as on the web (apps/web/src/features/files/appearance.ts
 * and AppearanceDialog.tsx). The choices themselves are shared through @pulpo/contracts.
 */

export { FILE_COLORS, FILE_ICONS }

/** One choice in the picker: null puts back the kind's own color or icon. */
export type AppearanceChange = { color: FileColor | null } | { icon: FileIcon | null }

/** Whether an item can be given a color and icon: files and folders, not chats or shortcuts. */
export function hasAppearance(node: Pick<FileNode, 'kind'>): boolean {
  return node.kind === 'folder' || node.kind === 'doc' || node.kind === 'blob'
}

/** The items among `nodes` whose color and icon can be chosen. */
export function styledNodes<T extends Pick<FileNode, 'kind'>>(nodes: readonly T[]): T[] {
  return nodes.filter(hasAppearance)
}

/** Built-in folders keep their own icons, so with one among them only a color is offered. */
export function offersIcon(nodes: readonly Pick<FileNode, 'id' | 'systemRole'>[]): boolean {
  // Built-in, as `isBuiltIn` in display.ts has it (kept apart so menus need no API client).
  return !nodes.some((node) => Boolean(node.systemRole) || isTrashFolder(node))
}

/** The menu item that opens the picker, as the web words it. */
export function appearanceActionTitle(nodes: readonly Pick<FileNode, 'id' | 'systemRole'>[]): string {
  return offersIcon(nodes) ? 'Color and Icon…' : 'Color…'
}

/** The same in a toolbar, where there is less room. */
export function appearanceShortTitle(nodes: readonly Pick<FileNode, 'id' | 'systemRole'>[]): string {
  return offersIcon(nodes) ? 'Color & Icon' : 'Color'
}

/** The value every node shares, or undefined when they differ (then no option shows as chosen). */
function shared<T>(values: readonly T[]): T | undefined {
  return values.every((value) => value === values[0]) ? values[0] : undefined
}

/** What the picker starts from: the color and icon the items share. */
export function sharedAppearance(nodes: readonly Pick<FileNode, 'color' | 'icon'>[]): { color: FileColor | null | undefined; icon: FileIcon | null | undefined } {
  return {
    color: shared(nodes.map((node) => node.color ?? null)),
    icon: shared(nodes.map((node) => node.icon ?? null)),
  }
}

/** The items whose change goes to the server: the trash isn't stored in Files, so its color is a setting. */
export function storedAppearanceIds(nodes: readonly Pick<FileNode, 'id'>[]): string[] {
  return nodes.filter((node) => !isTrashFolder(node)).map((node) => node.id)
}

/** `node` with the change applied if it is one of `ids`, or a shortcut to one. */
export function restyled<T extends FileNode>(node: T, ids: ReadonlySet<string>, change: AppearanceChange): T {
  if (ids.has(node.id)) return { ...node, ...change }
  if (node.kind === 'shortcut' && node.target && ids.has(node.target.id)) return { ...node, target: { ...node.target, ...change } }
  return node
}

export const FILE_COLOR_LABELS: Record<FileColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  gray: 'Gray',
}

export const FILE_ICON_LABELS: Record<FileIcon, string> = {
  star: 'Star',
  heart: 'Heart',
  bookmark: 'Bookmark',
  flag: 'Flag',
  book: 'Book',
  briefcase: 'Briefcase',
  code: 'Code',
  music: 'Music',
  image: 'Image',
  camera: 'Camera',
  film: 'Film',
  'graduation-cap': 'Graduation cap',
  home: 'Home',
  globe: 'Globe',
  lightbulb: 'Lightbulb',
  flask: 'Flask',
  rocket: 'Rocket',
  gamepad: 'Game controller',
  'shopping-cart': 'Shopping cart',
  plane: 'Plane',
  wallet: 'Wallet',
  calendar: 'Calendar',
  lock: 'Lock',
  users: 'People',
  sparkles: 'Sparkles',
  palette: 'Palette',
  pen: 'Pen',
  wrench: 'Wrench',
  leaf: 'Leaf',
  coffee: 'Coffee',
}
