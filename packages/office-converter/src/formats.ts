/**
 * What the converter accepts and produces. LibreOffice would guess a file's type from its
 * content, so a ".doc" holding HTML would be imported as a web page and fetch its images. Each
 * input instead names the container signatures it may have and the import filter forced for
 * each, so the bytes are only ever read by the filter their name promises.
 */

export type TargetFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf'
export type DocumentFamily = 'text' | 'spreadsheet' | 'presentation'
export type Signature = 'cfb' | 'zip' | 'rtf' | 'wpd'

interface InputFormat {
  family: DocumentFamily
  /** The LibreOffice import filter for each container this extension may hold. */
  filters: Partial<Record<Signature, string>>
}

export const INPUT_FORMATS = {
  // Word processing. Many ".doc" files written by other programs are really RTF.
  doc: { family: 'text', filters: { cfb: 'MS Word 97', rtf: 'Rich Text Format' } },
  rtf: { family: 'text', filters: { rtf: 'Rich Text Format' } },
  odt: { family: 'text', filters: { zip: 'writer8' } },
  ott: { family: 'text', filters: { zip: 'writer8_template' } },
  wpd: { family: 'text', filters: { wpd: 'WordPerfect' } },
  pages: { family: 'text', filters: { zip: 'Apple Pages' } },
  docx: { family: 'text', filters: { zip: 'MS Word 2007 XML', cfb: 'MS Word 2007 XML' } },
  dotx: { family: 'text', filters: { zip: 'MS Word 2007 XML Template', cfb: 'MS Word 2007 XML Template' } },
  // Spreadsheets. Encrypted Office Open XML files are compound files (see encryption.ts).
  xls: { family: 'spreadsheet', filters: { cfb: 'MS Excel 97' } },
  ods: { family: 'spreadsheet', filters: { zip: 'calc8' } },
  ots: { family: 'spreadsheet', filters: { zip: 'calc8_template' } },
  numbers: { family: 'spreadsheet', filters: { zip: 'Apple Numbers' } },
  xlsx: { family: 'spreadsheet', filters: { zip: 'Calc MS Excel 2007 XML', cfb: 'Calc MS Excel 2007 XML' } },
  xltx: { family: 'spreadsheet', filters: { zip: 'Calc MS Excel 2007 XML Template', cfb: 'Calc MS Excel 2007 XML Template' } },
  // Presentations.
  ppt: { family: 'presentation', filters: { cfb: 'MS PowerPoint 97' } },
  pps: { family: 'presentation', filters: { cfb: 'MS PowerPoint 97 AutoPlay' } },
  odp: { family: 'presentation', filters: { zip: 'impress8' } },
  otp: { family: 'presentation', filters: { zip: 'impress8_template' } },
  key: { family: 'presentation', filters: { zip: 'Apple Keynote' } },
  pptx: { family: 'presentation', filters: { zip: 'Impress MS PowerPoint 2007 XML', cfb: 'Impress MS PowerPoint 2007 XML' } },
  potx: { family: 'presentation', filters: { zip: 'Impress MS PowerPoint 2007 XML Template', cfb: 'Impress MS PowerPoint 2007 XML Template' } },
} as const satisfies Record<string, InputFormat>

export type InputExtension = keyof typeof INPUT_FORMATS

/** The editable format each family converts to. */
export const EDITABLE_TARGET: Record<DocumentFamily, Exclude<TargetFormat, 'pdf'>> = {
  text: 'docx',
  spreadsheet: 'xlsx',
  presentation: 'pptx',
}

const EXPORT_FILTERS: Record<DocumentFamily, Record<TargetFormat, string | null>> = {
  text: { docx: 'docx:MS Word 2007 XML', xlsx: null, pptx: null, pdf: 'pdf:writer_pdf_Export' },
  spreadsheet: { docx: null, xlsx: 'xlsx:Calc MS Excel 2007 XML', pptx: null, pdf: 'pdf:calc_pdf_Export' },
  presentation: { docx: null, xlsx: null, pptx: 'pptx:Impress MS PowerPoint 2007 XML', pdf: 'pdf:impress_pdf_Export' },
}

export const TARGET_CONTENT_TYPES: Record<TargetFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
}

export function isInputExtension(value: string): value is InputExtension {
  return Object.hasOwn(INPUT_FORMATS, value)
}

export function isTargetFormat(value: string): value is TargetFormat {
  return Object.hasOwn(TARGET_CONTENT_TYPES, value)
}

/**
 * Whether `from` can become `to`: its family's editable format (never itself; a template becomes
 * its ordinary form) or PDF.
 */
export function supportsConversion(from: string, to: string): boolean {
  if (!isInputExtension(from) || !isTargetFormat(to) || from === to) return false
  return EXPORT_FILTERS[INPUT_FORMATS[from].family][to] !== null
}

/** Every supported conversion, for health checks and the server's capability table. */
export function supportedConversions(): Array<{ from: InputExtension; to: TargetFormat }> {
  return (Object.keys(INPUT_FORMATS) as InputExtension[]).flatMap((from) =>
    (Object.keys(TARGET_CONTENT_TYPES) as TargetFormat[]).filter((to) => supportsConversion(from, to)).map((to) => ({ from, to })))
}

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function startsWith(bytes: Uint8Array, prefix: ArrayLike<number>): boolean {
  if (bytes.length < prefix.length) return false
  for (let index = 0; index < prefix.length; index += 1) if (bytes[index] !== prefix[index]) return false
  return true
}

/** The container the bytes are, judged by their first bytes only. */
export function sniffSignature(bytes: Uint8Array): Signature | null {
  if (startsWith(bytes, CFB_MAGIC)) return 'cfb'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return 'rtf' // {\rtf
  if (startsWith(bytes, [0xff, 0x57, 0x50, 0x43])) return 'wpd' // \xFFWPC
  return null
}

export interface ConversionPlan {
  family: DocumentFamily
  signature: Signature
  /** Passed to `soffice --infilter`. */
  importFilter: string
  /** Passed to `soffice --convert-to`. */
  exportFilter: string
}

export class UnsupportedConversionError extends Error {
  constructor(readonly code: 'unsupported_conversion' | 'unexpected_content', message: string) {
    super(message)
  }
}

/** How to convert these bytes, or why they cannot be converted. */
export function planConversion(from: string, to: string, bytes: Uint8Array): ConversionPlan {
  if (!supportsConversion(from, to)) throw new UnsupportedConversionError('unsupported_conversion', `Converting .${from} files to .${to} is not supported`)
  const format: InputFormat = INPUT_FORMATS[from as InputExtension]
  const signature = sniffSignature(bytes)
  const importFilter = signature ? format.filters[signature] : undefined
  if (!signature || !importFilter) {
    throw new UnsupportedConversionError('unexpected_content', `This file does not contain a .${from} document`)
  }
  return { family: format.family, signature, importFilter, exportFilter: EXPORT_FILTERS[format.family][to as TargetFormat]! }
}
