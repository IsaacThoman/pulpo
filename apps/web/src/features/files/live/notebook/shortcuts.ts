import { ui } from '@/i18n/ui'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl+'

/** Keys JupyterLab, VS Code, and Colab users bring along, for the shortcuts dialog (labels as thunks, read when shown). */
export const FAMILIAR_SHORTCUTS: [string, () => string][] = [
  ['Shift+Z', () => ui("Redo")],
  ['1 … 6', () => ui("Make a Markdown heading of that level")],
  ['Alt+↑ / Alt+↓', () => ui("Move the selected cells up or down")],
  ['Shift+Alt+↑ / Shift+Alt+↓', () => ui("Duplicate the selected cells above or below")],
  [`${mod}C / ${mod}X / ${mod}V`, () => ui("Copy, cut, or paste cells; pasted text becomes a new cell")],
  [mac ? '⌘F / ⌘⌥F' : 'Ctrl+F / Ctrl+H', () => ui("Find, or find and replace, in every cell")],
  ['Shift+L', () => ui("Show or hide line numbers")],
  ['Shift+O', () => ui("Scroll long outputs, or show them in full")],
  ['H', () => ui("Show these shortcuts")],
  ['Ctrl+M, A / B / D', () => ui("Colab: insert a cell above or below, or delete it (also while editing)")],
  ['Ctrl+M, Y / M / L / O / H', () => ui("Colab: make code or Markdown, line numbers, outputs, these shortcuts")],
]
