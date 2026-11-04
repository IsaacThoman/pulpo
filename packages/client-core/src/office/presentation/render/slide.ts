import type { PresentationSnapshot, SlideSnapshot } from '../model.js'
import { RelationshipTable, buildShapeElement } from '../write.js'
import { child, childElements, namespaceDeclarations, NS, parseXmlDocument, path, type XmlElement } from '../xml.js'
import { DEFAULT_COLOR_MAP, type ColorContext } from './color.js'
import { DeckResources, placeholderOf, readColorMap, type LayoutInfo, type MasterInfo } from './deck.js'
import { DEFAULT_RENDER_LABELS, emuToPx, escapeAttribute, num, px, type RenderEnv, type RenderLabels } from './env.js'
import { paintFill, styleReference, themeFill } from './fill.js'
import { renderShape, ROOT_FRAME } from './shape.js'

/**
 * Whole slides as HTML: background, then the master's and layout's own (non-placeholder)
 * shapes, then the slide's shapes. The result is a fixed-size box in px at 100% zoom that callers
 * scale with CSS.
 */

export interface SlideRenderOptions {
  deck: DeckResources
  slideNumber: number
  mode: 'edit' | 'view'
  labels?: RenderLabels
  assetUrl(partPath: string): string | undefined
  /** Prefix for SVG ids, unique per page so several slides can be on screen at once. */
  idPrefix: string
  now?: Date
  /** Shape keys whose text the inline editor is drawing. */
  hideTextOf?: ReadonlySet<string>
}

export function deckResources(snapshot: Pick<PresentationSnapshot, 'parts' | 'mainPart'>, existing?: DeckResources): DeckResources {
  if (existing) {
    existing.update(snapshot.parts, snapshot.mainPart)
    return existing
  }
  return new DeckResources(snapshot.parts, snapshot.mainPart)
}

export interface SlideEnvironment {
  env: RenderEnv
  layout?: LayoutInfo
  master?: MasterInfo
  root: XmlElement
  rels: RelationshipTable
}

/** Resolves a slide's layout, master, theme, and color map. */
export function slideEnvironment(slide: SlideSnapshot, options: SlideRenderOptions): SlideEnvironment {
  const layout = slide.layout ? options.deck.layout(slide.layout) : undefined
  const master = layout?.master ?? (options.deck.masterPaths()[0] ? options.deck.master(options.deck.masterPaths()[0]!) : undefined)
  const root = parseXmlDocument(slide.xml || '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>').documentElement!
  const slideMap = readColorMap(path(root, 'clrMapOvr', 'overrideClrMapping'))
  const colors: ColorContext = {
    scheme: master?.theme.colors ?? {},
    colorMap: slideMap ?? layout?.colorMap ?? master?.colorMap ?? DEFAULT_COLOR_MAP,
  }
  const rels = new RelationshipTable()
  for (const [id, rel] of Object.entries(slide.rels)) rels.set(id, rel)
  let counter = 0
  const env: RenderEnv = {
    deck: options.deck,
    theme: master?.theme ?? options.deck.theme(undefined),
    colors,
    ...(layout ? { layout } : {}),
    ...(master ? { master } : {}),
    rel: (id) => rels.entries.get(id),
    assetUrl: options.assetUrl,
    nextId: () => `${options.idPrefix}-${(counter++).toString(36)}`,
    slideNumber: options.slideNumber,
    mode: options.mode,
    labels: options.labels ?? DEFAULT_RENDER_LABELS,
    now: options.now ?? new Date(),
  }
  return { env, ...(layout ? { layout } : {}), ...(master ? { master } : {}), root, rels }
}

function backgroundOf(element: XmlElement | undefined): XmlElement | undefined {
  return child(child(element, 'cSld', NS.p), 'bg', NS.p)
}

/** The slide background as an SVG layer: the slide's own, else the layout's, else the master's. */
function renderBackground(slide: SlideSnapshot, environment: SlideEnvironment, width: number, height: number): string {
  const { env, layout, master } = environment
  let background: XmlElement | undefined
  let backgroundEnv = env
  if (slide.background) {
    background = parseXmlDocument(`<w xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">${slide.background}</w>`).documentElement!.firstChild as XmlElement
  } else if (backgroundOf(layout?.root)) {
    background = backgroundOf(layout!.root)
    const rels = env.deck.rels(layout!.path)
    backgroundEnv = { ...env, rel: (id) => rels.get(id) }
  } else if (backgroundOf(master?.root)) {
    background = backgroundOf(master!.root)
    const rels = env.deck.rels(master!.path)
    backgroundEnv = { ...env, rel: (id) => rels.get(id) }
  }
  const box = { w: width, h: height }
  let paint = { value: 'rgb(255, 255, 255)', defs: '' }
  const properties = child(background, 'bgPr', NS.p)
  if (properties) {
    const fill = childElements(properties).find((entry) => ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill'].includes(entry.localName ?? ''))
    const result = paintFill(fill, backgroundEnv, box)
    if (result.value !== 'none') paint = result
  } else {
    const reference = child(background, 'bgRef', NS.p)
    const resolved = styleReference(reference, (index) => themeFill(env.theme, index), backgroundEnv)
    if (resolved) {
      const result = paintFill(resolved.element, backgroundEnv, box, resolved.colors)
      if (result.value !== 'none') paint = result
    }
  }
  return `<svg class="pp-background" width="${num(width)}" height="${num(height)}" style="position:absolute;left:0;top:0" aria-hidden="true">${paint.defs ? `<defs>${paint.defs}</defs>` : ''}<rect width="100%" height="100%" fill="${paint.value}"/></svg>`
}

/** Non-placeholder shapes of a layout or master, drawn under the slide's own. */
function inheritedShapes(root: XmlElement | undefined, partPath: string, level: 'layout' | 'master', environment: SlideEnvironment): string {
  const tree = path(root, 'cSld', 'spTree')
  if (!tree) return ''
  const rels = environment.env.deck.rels(partPath)
  const env: RenderEnv = { ...environment.env, rel: (id) => rels.get(id), mode: 'view' }
  return childElements(tree)
    .filter((element) => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(element.localName ?? '') && !placeholderOf(element))
    .map((element) => renderShape(element, { env, level, frame: ROOT_FRAME }))
    .join('')
}

export function renderSlide(slide: SlideSnapshot, snapshot: Pick<PresentationSnapshot, 'slideWidth' | 'slideHeight'>, options: SlideRenderOptions): string {
  const width = emuToPx(snapshot.slideWidth)
  const height = emuToPx(snapshot.slideHeight)
  const environment = slideEnvironment(slide, options)
  const { env, layout, master, root } = environment
  const showMasterShapes = root.getAttribute('showMasterSp') !== '0'
  const layers = [renderBackground(slide, environment, width, height)]
  if (showMasterShapes && master && layout?.showMasterShapes !== false) layers.push(inheritedShapes(master.root, master.path, 'master', environment))
  if (showMasterShapes && layout) layers.push(inheritedShapes(layout.root, layout.path, 'layout', environment))
  const document = parseXmlDocument('<w/>')
  const prefixes = namespaceDeclarations(root)
  for (const shape of slide.shapes) {
    let element: XmlElement
    try {
      element = buildShapeElement(document, shape, prefixes, environment.rels)
    } catch {
      continue
    }
    layers.push(renderShape(element, { env, level: 'slide', frame: ROOT_FRAME, key: shape.key, hideText: options.hideTextOf?.has(shape.key) === true }))
  }
  return `<div class="pp-slide" data-slide-key="${escapeAttribute(slide.key)}" style="position:relative;width:${px(width)};height:${px(height)};overflow:hidden;background:white;contain:layout paint">${layers.join('')}</div>`
}
