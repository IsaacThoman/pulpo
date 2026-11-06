import { emuToPt } from './css.js'
import { cloneJml, jmlAttr, jmlChild, jmlNumber, jmlText, packJml, walkJml, type JmlElement } from './jsonml.js'
import { drawingSize } from './schema.js'

/** What the renderer needs to know about a `w:drawing` (or VML picture, or alternate content). */
export interface DrawingInfo {
  placement: 'inline' | 'anchor'
  /** Points. */
  width: number
  height: number
  /** Cropped share of each side, 0–1. */
  crop: { left: number; top: number; right: number; bottom: number }
  wrap: 'none' | 'square' | 'tight' | 'through' | 'topAndBottom'
  behind: boolean
  horizontal: { relativeFrom: string; offset?: number; align?: string }
  vertical: { relativeFrom: string; offset?: number; align?: string }
  description?: string
  /** What sort of object it is, for placeholders. */
  content: 'picture' | 'chart' | 'shape' | 'textBox' | 'object'
  /** Text inside a text box, shown in its placeholder. */
  text?: string
}

const EMU_PER_PT = 12700

function position(element: JmlElement | undefined): { relativeFrom: string; offset?: number; align?: string } {
  const offset = jmlChild(element, 'wp:posOffset')
  const align = jmlChild(element, 'wp:align')
  return {
    relativeFrom: jmlAttr(element, 'relativeFrom') ?? 'column',
    ...(offset ? { offset: emuToPt(Number(jmlText(offset)) || 0) } : {}),
    ...(align ? { align: jmlText(align).trim() } : {}),
  }
}

/** The drawing shown for an `mc:AlternateContent`: Word's own choice if it is a drawing, else the fallback. */
function primaryDrawing(element: JmlElement): JmlElement {
  if (element[0] !== 'mc:AlternateContent') return element
  let found: JmlElement | undefined
  walkJml(element, (child) => {
    if (found) return false
    if (child[0] === 'w:drawing' || child[0] === 'w:pict' || child[0] === 'w:object') {
      found = child
      return false
    }
    return undefined
  })
  return found ?? element
}

export function drawingInfo(element: JmlElement): DrawingInfo {
  const drawing = primaryDrawing(element)
  const anchor = jmlChild(drawing, 'wp:anchor')
  const frame = anchor ?? jmlChild(drawing, 'wp:inline')
  const size = drawingSize(drawing) ?? drawingSize(element) ?? { width: 72, height: 72 }
  const info: DrawingInfo = {
    placement: anchor ? 'anchor' : 'inline',
    width: size.width,
    height: size.height,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    wrap: 'none',
    behind: jmlAttr(anchor, 'behindDoc') === '1',
    horizontal: position(jmlChild(anchor, 'wp:positionH')),
    vertical: position(jmlChild(anchor, 'wp:positionV')),
    description: jmlAttr(jmlChild(frame, 'wp:docPr'), 'descr') || jmlAttr(jmlChild(frame, 'wp:docPr'), 'title') || undefined,
    content: 'object',
  }
  if (anchor) {
    if (jmlChild(anchor, 'wp:wrapSquare')) info.wrap = 'square'
    else if (jmlChild(anchor, 'wp:wrapTight')) info.wrap = 'tight'
    else if (jmlChild(anchor, 'wp:wrapThrough')) info.wrap = 'through'
    else if (jmlChild(anchor, 'wp:wrapTopAndBottom')) info.wrap = 'topAndBottom'
  }
  let text = ''
  walkJml(element, (child) => {
    switch (child[0]) {
      case 'pic:pic':
        if (info.content === 'object') info.content = 'picture'
        break
      case 'c:chart':
      case 'cx:chart':
        info.content = 'chart'
        break
      case 'wps:wsp':
      case 'wpg:wgp':
      case 'v:shape':
      case 'v:rect':
      case 'v:roundrect':
        if (info.content === 'object') info.content = 'shape'
        break
      case 'w:txbxContent':
        info.content = 'textBox'
        if (!text) text = textBoxText(child)
        return false
      case 'a:srcRect': {
        const share = (name: string) => Math.max(0, Math.min(0.99, (jmlNumber(child, name) ?? 0) / 100_000))
        info.crop = { left: share('l'), top: share('t'), right: share('r'), bottom: share('b') }
        break
      }
      case 'v:imagedata':
        if (info.content === 'object' || info.content === 'shape') info.content = 'picture'
        break
      default:
        break
    }
    return undefined
  })
  if (text) info.text = text
  return info
}

function textBoxText(content: JmlElement): string {
  const lines: string[] = []
  walkJml(content, (child) => {
    if (child[0] === 'w:p') {
      let line = ''
      walkJml(child, (inner) => {
        if (inner[0] === 'w:t') line += jmlText(inner)
        else if (inner[0] === 'w:tab') line += '\t'
        return undefined
      })
      lines.push(line)
      return false
    }
    return undefined
  })
  return lines.join('\n')
}

/** The drawing at a new size in points, keeping everything else as written. */
export function resizeDrawing(element: JmlElement, width: number, height: number): string {
  const copy = cloneJml(element)
  const cx = String(Math.max(1, Math.round(width * EMU_PER_PT)))
  const cy = String(Math.max(1, Math.round(height * EMU_PER_PT)))
  walkJml(copy, (child) => {
    if (child[0] === 'wp:extent') {
      child[1].cx = cx
      child[1].cy = cy
    } else if (child[0] === 'a:ext' && child[1].cx !== undefined && child[1].cy !== undefined) {
      child[1].cx = cx
      child[1].cy = cy
    } else if (child[0] === 'v:shape' && child[1].style) {
      child[1].style = child[1].style.replace(/width:[^;]+/, `width:${Math.round(width * 100) / 100}pt`).replace(/height:[^;]+/, `height:${Math.round(height * 100) / 100}pt`)
    }
    return undefined
  })
  return packJml(copy)
}

let drawingCounter = 0

/** A new inline picture, as Word writes it; `relId` is filled in on export from the asset. */
export function newInlinePicture(widthPt: number, heightPt: number, name: string, description = ''): JmlElement {
  const id = String(Date.now() % 1_000_000 * 10 + (drawingCounter++ % 10))
  const cx = String(Math.round(widthPt * EMU_PER_PT))
  const cy = String(Math.round(heightPt * EMU_PER_PT))
  return ['w:drawing', {},
    ['wp:inline', { distT: '0', distB: '0', distL: '0', distR: '0' },
      ['wp:extent', { cx, cy }],
      ['wp:effectExtent', { l: '0', t: '0', r: '0', b: '0' }],
      ['wp:docPr', { id, name, descr: description }],
      ['wp:cNvGraphicFramePr', {}, ['a:graphicFrameLocks', { 'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main', noChangeAspect: '1' }]],
      ['a:graphic', { 'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main' },
        ['a:graphicData', { uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' },
          ['pic:pic', { 'xmlns:pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture' },
            ['pic:nvPicPr', {}, ['pic:cNvPr', { id: '0', name }], ['pic:cNvPicPr', {}]],
            ['pic:blipFill', {}, ['a:blip', { 'r:embed': 'rIdPulpoNew' }], ['a:stretch', {}, ['a:fillRect', {}]]],
            ['pic:spPr', {}, ['a:xfrm', {}, ['a:off', { x: '0', y: '0' }], ['a:ext', { cx, cy }]], ['a:prstGeom', { prst: 'rect' }, ['a:avLst', {}]]],
          ],
        ],
      ],
    ],
  ]
}
