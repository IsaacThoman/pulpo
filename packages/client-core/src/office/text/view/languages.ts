import type { LanguageSupport, StreamLanguage, StreamParser } from '@codemirror/language'
import { nameExtension } from '../../formats.js'

/**
 * Syntax highlighting per file name, loaded only when a file of that language opens: each loader
 * is a dynamic import, so web builds split them into their own chunks.
 */
export type LanguageLoader = () => Promise<LanguageSupport | StreamLanguage<unknown>>

const legacy = (load: () => Promise<StreamParser<unknown>>): LanguageLoader => async () => {
  const [{ StreamLanguage }, parser] = await Promise.all([import('@codemirror/language'), load()])
  return StreamLanguage.define(parser)
}

const javascript = (options: { jsx?: boolean; typescript?: boolean }): LanguageLoader => async () => (await import('@codemirror/lang-javascript')).javascript(options)
const json: LanguageLoader = async () => (await import('@codemirror/lang-json')).json()
const html: LanguageLoader = async () => (await import('@codemirror/lang-html')).html()
const css: LanguageLoader = async () => (await import('@codemirror/lang-css')).css()
const python: LanguageLoader = async () => (await import('@codemirror/lang-python')).python()
const sql: LanguageLoader = async () => (await import('@codemirror/lang-sql')).sql()
const rust: LanguageLoader = async () => (await import('@codemirror/lang-rust')).rust()
const cpp: LanguageLoader = async () => (await import('@codemirror/lang-cpp')).cpp()
const java: LanguageLoader = async () => (await import('@codemirror/lang-java')).java()
const php: LanguageLoader = async () => (await import('@codemirror/lang-php')).php()
const go: LanguageLoader = async () => (await import('@codemirror/lang-go')).go()
const yaml: LanguageLoader = async () => (await import('@codemirror/lang-yaml')).yaml()
const xml: LanguageLoader = async () => (await import('@codemirror/lang-xml')).xml()

const ruby = legacy(async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby)
const shell = legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell)
const swift = legacy(async () => (await import('@codemirror/legacy-modes/mode/swift')).swift)
const kotlin = legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin)
const scala = legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).scala)
const csharp = legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp)
const dart = legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).dart)
const objectiveC = legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).objectiveC)
const lua = legacy(async () => (await import('@codemirror/legacy-modes/mode/lua')).lua)
const r = legacy(async () => (await import('@codemirror/legacy-modes/mode/r')).r)
const perl = legacy(async () => (await import('@codemirror/legacy-modes/mode/perl')).perl)
const toml = legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml)
const properties = legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties)
const dockerfile = legacy(async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile)
const diff = legacy(async () => (await import('@codemirror/legacy-modes/mode/diff')).diff)
const stex = legacy(async () => (await import('@codemirror/legacy-modes/mode/stex')).stex)
const haskell = legacy(async () => (await import('@codemirror/legacy-modes/mode/haskell')).haskell)
const clojure = legacy(async () => (await import('@codemirror/legacy-modes/mode/clojure')).clojure)
const erlang = legacy(async () => (await import('@codemirror/legacy-modes/mode/erlang')).erlang)
const groovy = legacy(async () => (await import('@codemirror/legacy-modes/mode/groovy')).groovy)
const julia = legacy(async () => (await import('@codemirror/legacy-modes/mode/julia')).julia)
const fSharp = legacy(async () => (await import('@codemirror/legacy-modes/mode/mllike')).fSharp)
const elm = legacy(async () => (await import('@codemirror/legacy-modes/mode/elm')).elm)
const cmake = legacy(async () => (await import('@codemirror/legacy-modes/mode/cmake')).cmake)
const protobuf = legacy(async () => (await import('@codemirror/legacy-modes/mode/protobuf')).protobuf)
const powershell = legacy(async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell)
const sass = legacy(async () => (await import('@codemirror/legacy-modes/mode/sass')).sass)

/** The language and its display name, by extension. */
const BY_EXTENSION: Record<string, { name: string; load: LanguageLoader }> = {
  js: { name: 'JavaScript', load: javascript({ jsx: true }) },
  mjs: { name: 'JavaScript', load: javascript({}) },
  cjs: { name: 'JavaScript', load: javascript({}) },
  jsx: { name: 'JavaScript (JSX)', load: javascript({ jsx: true }) },
  ts: { name: 'TypeScript', load: javascript({ typescript: true }) },
  mts: { name: 'TypeScript', load: javascript({ typescript: true }) },
  cts: { name: 'TypeScript', load: javascript({ typescript: true }) },
  tsx: { name: 'TypeScript (TSX)', load: javascript({ jsx: true, typescript: true }) },
  json: { name: 'JSON', load: json },
  jsonc: { name: 'JSON', load: json },
  json5: { name: 'JSON5', load: json },
  html: { name: 'HTML', load: html },
  htm: { name: 'HTML', load: html },
  vue: { name: 'Vue', load: html },
  svelte: { name: 'Svelte', load: html },
  css: { name: 'CSS', load: css },
  less: { name: 'Less', load: css },
  scss: { name: 'SCSS', load: css },
  sass: { name: 'Sass', load: sass },
  py: { name: 'Python', load: python },
  pyi: { name: 'Python', load: python },
  sql: { name: 'SQL', load: sql },
  rs: { name: 'Rust', load: rust },
  c: { name: 'C', load: cpp },
  h: { name: 'C', load: cpp },
  cc: { name: 'C++', load: cpp },
  cpp: { name: 'C++', load: cpp },
  cxx: { name: 'C++', load: cpp },
  hpp: { name: 'C++', load: cpp },
  hh: { name: 'C++', load: cpp },
  hxx: { name: 'C++', load: cpp },
  m: { name: 'Objective-C', load: objectiveC },
  mm: { name: 'Objective-C++', load: objectiveC },
  java: { name: 'Java', load: java },
  php: { name: 'PHP', load: php },
  go: { name: 'Go', load: go },
  yaml: { name: 'YAML', load: yaml },
  yml: { name: 'YAML', load: yaml },
  xml: { name: 'XML', load: xml },
  plist: { name: 'XML', load: xml },
  rb: { name: 'Ruby', load: ruby },
  sh: { name: 'Shell', load: shell },
  bash: { name: 'Shell', load: shell },
  zsh: { name: 'Shell', load: shell },
  fish: { name: 'Shell', load: shell },
  swift: { name: 'Swift', load: swift },
  kt: { name: 'Kotlin', load: kotlin },
  kts: { name: 'Kotlin', load: kotlin },
  scala: { name: 'Scala', load: scala },
  cs: { name: 'C#', load: csharp },
  fs: { name: 'F#', load: fSharp },
  dart: { name: 'Dart', load: dart },
  lua: { name: 'Lua', load: lua },
  r: { name: 'R', load: r },
  pl: { name: 'Perl', load: perl },
  pm: { name: 'Perl', load: perl },
  toml: { name: 'TOML', load: toml },
  ini: { name: 'INI', load: properties },
  cfg: { name: 'INI', load: properties },
  conf: { name: 'Config', load: properties },
  properties: { name: 'Properties', load: properties },
  env: { name: 'Environment', load: properties },
  dockerfile: { name: 'Dockerfile', load: dockerfile },
  diff: { name: 'Diff', load: diff },
  patch: { name: 'Diff', load: diff },
  tex: { name: 'LaTeX', load: stex },
  hs: { name: 'Haskell', load: haskell },
  clj: { name: 'Clojure', load: clojure },
  erl: { name: 'Erlang', load: erlang },
  groovy: { name: 'Groovy', load: groovy },
  gradle: { name: 'Gradle', load: groovy },
  jl: { name: 'Julia', load: julia },
  elm: { name: 'Elm', load: elm },
  cmake: { name: 'CMake', load: cmake },
  proto: { name: 'Protocol Buffers', load: protobuf },
  ps1: { name: 'PowerShell', load: powershell },
}

const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', '.env': 'env', '.npmrc': 'ini', '.editorconfig': 'ini' }

/** The language a file name is highlighted as, or null for plain text. */
export function languageOf(name: string): { name: string; load: LanguageLoader } | null {
  return BY_EXTENSION[nameExtension(name)] ?? BY_EXTENSION[BY_NAME[name.toLowerCase()] ?? ''] ?? null
}
