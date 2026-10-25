import type { FileColor, FileIcon, FileNode } from '@pulpo/contracts'
import {
  Book,
  Bookmark,
  Briefcase,
  Calendar,
  Camera,
  Code,
  Coffee,
  Film,
  Flag,
  FlaskConical,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  House,
  Image,
  Leaf,
  Lightbulb,
  Lock,
  Music,
  Palette,
  PenLine,
  Plane,
  Rocket,
  ShoppingCart,
  Sparkles,
  Star,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { create } from 'zustand'

/** The files and folders whose color and icon are being chosen. The Sidebar renders the dialog. */
export const useAppearanceEditor = create<{ nodes: FileNode[] | null }>()(() => ({ nodes: null }))

/** Whether an item can be given a color and icon: files and folders, not chats or shortcuts. */
export function hasAppearance(node: Pick<FileNode, 'kind'>): boolean {
  return node.kind === 'folder' || node.kind === 'doc' || node.kind === 'blob' || node.kind === 'recording'
}

/** Opens the color and icon dialog for files and folders; anything else among `nodes` is left out. */
export function editAppearance(nodes: readonly FileNode[]) {
  const styled = nodes.filter(hasAppearance)
  if (styled.length) useAppearanceEditor.setState({ nodes: styled })
}

/** The icons a file or folder can be given, by FileIcon. */
export const FILE_ICON_GLYPHS: Record<FileIcon, LucideIcon> = {
  star: Star, heart: Heart, bookmark: Bookmark, flag: Flag, book: Book,
  briefcase: Briefcase, code: Code, music: Music, image: Image, camera: Camera,
  film: Film, 'graduation-cap': GraduationCap, home: House, globe: Globe, lightbulb: Lightbulb,
  flask: FlaskConical, rocket: Rocket, gamepad: Gamepad2, 'shopping-cart': ShoppingCart, plane: Plane,
  wallet: Wallet, calendar: Calendar, lock: Lock, users: Users, sparkles: Sparkles,
  palette: Palette, pen: PenLine, wrench: Wrench, leaf: Leaf, coffee: Coffee,
}

/** Classes for each FileColor: the icon's stroke, a folder's fill, and the picker's swatch. */
export const FILE_COLOR_CLASSES: Record<FileColor, { text: string; fill: string; swatch: string }> = {
  red: { text: 'text-red-500', fill: 'fill-red-500/20', swatch: 'bg-red-500' },
  orange: { text: 'text-orange-500', fill: 'fill-orange-500/20', swatch: 'bg-orange-500' },
  yellow: { text: 'text-yellow-500', fill: 'fill-yellow-500/20', swatch: 'bg-yellow-500' },
  green: { text: 'text-green-600 dark:text-green-500', fill: 'fill-green-500/20', swatch: 'bg-green-500' },
  teal: { text: 'text-teal-500', fill: 'fill-teal-500/20', swatch: 'bg-teal-500' },
  blue: { text: 'text-blue-500', fill: 'fill-blue-500/20', swatch: 'bg-blue-500' },
  purple: { text: 'text-purple-500', fill: 'fill-purple-500/20', swatch: 'bg-purple-500' },
  pink: { text: 'text-pink-500', fill: 'fill-pink-500/20', swatch: 'bg-pink-500' },
  gray: { text: 'text-zinc-500', fill: 'fill-zinc-500/20', swatch: 'bg-zinc-500' },
}
