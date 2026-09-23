/**
 * Libraries a JSX preview may import. Each loader is a separate code-split chunk, so a preview only
 * downloads what its source actually requires (and the browser caches it for later previews).
 */
export const SANDBOX_MODULES: Record<string, () => Promise<unknown>> = {
  react: () => import('react'),
  'react-dom': () => import('react-dom'),
  'react-dom/client': () => import('react-dom/client'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  // The app lazy-loads lucide per icon, so its ESM build is split into ~1,500 chunks. The single-file
  // CommonJS build keeps a preview's lucide import to one request.
  'lucide-react': () => import('lucide-react/dist/cjs/lucide-react.js'),
  recharts: () => import('recharts'),
}

/** Tailwind's browser build, for JSX that styles itself with utility classes. */
export const loadTailwind = () => import('@tailwindcss/browser')

const STYLESHEET = /\.(?:css|scss|sass|less)(?:\?.*)?$/i

/** Stylesheets from other files can't reach a single-file preview, but the component still renders without them. */
export function isStylesheetImport(specifier: string): boolean {
  return STYLESHEET.test(specifier)
}

function isLocalImport(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/')
}

function quoted(specifiers: string[]): string {
  return specifiers.map((specifier) => `"${specifier}"`).join(', ')
}

export class UnsupportedImportError extends Error {
  constructor(specifiers: string[]) {
    const local = specifiers.filter(isLocalImport)
    if (local.length) {
      super(`Previews run a single file, so ${quoted(local)} can't be loaded. Move that code into this file to preview it.`)
    } else {
      const available = Object.keys(SANDBOX_MODULES).filter((name) => !name.includes('/')).join(', ')
      super(`${quoted(specifiers)} ${specifiers.length === 1 ? "isn't" : "aren't"} available in previews. Available libraries: ${available}.`)
    }
    this.name = 'UnsupportedImportError'
  }
}

/** Load the libraries a preview requires. Stylesheet imports resolve to empty modules. */
export async function loadSandboxModules(specifiers: string[]): Promise<Map<string, unknown>> {
  const libraries = specifiers.filter((specifier) => !isStylesheetImport(specifier))
  const unsupported = libraries.filter((specifier) => !(specifier in SANDBOX_MODULES))
  if (unsupported.length) throw new UnsupportedImportError(unsupported)
  const entries = await Promise.all(libraries.map(async (specifier) => [specifier, await SANDBOX_MODULES[specifier]!()] as const))
  return new Map<string, unknown>([
    ...specifiers.filter(isStylesheetImport).map((specifier) => [specifier, {}] as const),
    ...entries,
  ])
}
