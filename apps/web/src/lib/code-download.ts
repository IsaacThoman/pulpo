// Fence tags (and their common aliases) mapped to the file extension a download should use.
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: 'js', js: 'js', mjs: 'mjs', cjs: 'cjs', jsx: 'jsx', react: 'jsx',
  typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py', ruby: 'rb', rb: 'rb', rust: 'rs', rs: 'rs', go: 'go', golang: 'go',
  java: 'java', kotlin: 'kt', kt: 'kt', kts: 'kts', swift: 'swift', scala: 'scala', dart: 'dart',
  c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'hpp',
  csharp: 'cs', 'c#': 'cs', cs: 'cs', objectivec: 'm', 'objective-c': 'm', objc: 'm',
  php: 'php', perl: 'pl', pl: 'pl', lua: 'lua', r: 'r',
  bash: 'sh', sh: 'sh', shell: 'sh', shellscript: 'sh', zsh: 'zsh', console: 'sh',
  powershell: 'ps1', ps1: 'ps1', bat: 'bat', cmd: 'bat',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  json: 'json', jsonc: 'jsonc', json5: 'json5', yaml: 'yaml', yml: 'yml', toml: 'toml', ini: 'ini',
  xml: 'xml', html: 'html', htm: 'html', svg: 'svg', vue: 'vue',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  markdown: 'md', md: 'md', latex: 'tex', tex: 'tex', diff: 'diff', patch: 'patch',
  csv: 'csv', tsv: 'tsv', makefile: 'mk', dockerfile: 'dockerfile',
}

/** File extension for a code block's fence tag; `txt` when the tag is missing or unknown. */
export function codeFileExtension(language: string | null | undefined): string {
  return LANGUAGE_EXTENSIONS[language?.trim().toLowerCase() ?? ''] ?? 'txt'
}

export function downloadCode(code: string, fileName: string, mimeType = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([code], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
