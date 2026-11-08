import { ui, uit } from '@/i18n/ui'

/**
 * Names people know from PowerPoint and Google Slides for what the file format calls by its own
 * ids: preset shapes ("Rounded rectangle", not `roundRect`), theme color slots ("Accent 1", not
 * `accent1`), standard colors, and line dashes. Built when asked, so they follow the language.
 */

/** The shape gallery's groups, as PowerPoint names them. */
const GALLERY_LABELS: Record<string, () => string> = {
  lines: () => ui("Lines"),
  rectangles: () => ui("Rectangles"),
  basicShapes: () => ui("Basic shapes"),
  blockArrows: () => ui("Block arrows"),
  equationShapes: () => ui("Equation shapes"),
  flowchart: () => ui("Flowchart"),
  starsAndBanners: () => ui("Stars and banners"),
  callouts: () => ui("Callouts"),
  actionButtons: () => ui("Action buttons"),
}

export function galleryLabel(id: string, fallback: string): string {
  return GALLERY_LABELS[id]?.() ?? fallback
}

/** Names of the shapes in the gallery, by preset id; unknown presets are spelled out from their id. */
const SHAPE_NAMES: Record<string, () => string> = {
  line: () => ui("Line"),
  straightConnector1: () => ui("Straight connector"),
  bentConnector3: () => ui("Elbow connector"),
  curvedConnector3: () => ui("Curved connector"),
  rect: () => ui("Rectangle"),
  roundRect: () => ui("Rounded rectangle"),
  snip1Rect: () => ui("Snip single corner rectangle"),
  snip2SameRect: () => ui("Snip same side corner rectangle"),
  snip2DiagRect: () => ui("Snip diagonal corner rectangle"),
  snipRoundRect: () => ui("Snip and round single corner rectangle"),
  round1Rect: () => ui("Round single corner rectangle"),
  round2SameRect: () => ui("Round same side corner rectangle"),
  round2DiagRect: () => ui("Round diagonal corner rectangle"),
  ellipse: () => ui("Oval"),
  triangle: () => ui("Isosceles triangle"),
  rtTriangle: () => ui("Right triangle"),
  parallelogram: () => ui("Parallelogram"),
  trapezoid: () => ui("Trapezoid"),
  diamond: () => ui("Diamond"),
  pentagon: () => ui("Regular pentagon"),
  hexagon: () => ui("Hexagon"),
  heptagon: () => ui("Heptagon"),
  octagon: () => ui("Octagon"),
  decagon: () => ui("Decagon"),
  dodecagon: () => ui("Dodecagon"),
  pie: () => ui("Partial circle"),
  chord: () => ui("Chord"),
  teardrop: () => ui("Teardrop"),
  frame: () => ui("Frame"),
  halfFrame: () => ui("Half frame"),
  corner: () => ui("L-shape"),
  diagStripe: () => ui("Diagonal stripe"),
  plus: () => ui("Cross"),
  plaque: () => ui("Plaque"),
  can: () => ui("Cylinder"),
  cube: () => ui("Cube"),
  bevel: () => ui("Bevel"),
  donut: () => ui("Donut"),
  noSmoking: () => ui("\"No\" symbol"),
  blockArc: () => ui("Block arc"),
  foldedCorner: () => ui("Folded corner"),
  smileyFace: () => ui("Smiley face"),
  heart: () => ui("Heart"),
  lightningBolt: () => ui("Lightning bolt"),
  sun: () => ui("Sun"),
  moon: () => ui("Moon"),
  cloud: () => ui("Cloud"),
  arc: () => ui("Arc"),
  bracketPair: () => ui("Double bracket"),
  bracePair: () => ui("Double brace"),
  leftBracket: () => ui("Left bracket"),
  rightBracket: () => ui("Right bracket"),
  leftBrace: () => ui("Left brace"),
  rightBrace: () => ui("Right brace"),
  rightArrow: () => ui("Right arrow"),
  leftArrow: () => ui("Left arrow"),
  upArrow: () => ui("Up arrow"),
  downArrow: () => ui("Down arrow"),
  leftRightArrow: () => ui("Left-right arrow"),
  upDownArrow: () => ui("Up-down arrow"),
  quadArrow: () => ui("Quad arrow"),
  leftRightUpArrow: () => ui("Left-right-up arrow"),
  bentArrow: () => ui("Bent arrow"),
  uturnArrow: () => ui("U-turn arrow"),
  leftUpArrow: () => ui("Left-up arrow"),
  bentUpArrow: () => ui("Bent-up arrow"),
  curvedRightArrow: () => ui("Curved right arrow"),
  curvedLeftArrow: () => ui("Curved left arrow"),
  curvedUpArrow: () => ui("Curved up arrow"),
  curvedDownArrow: () => ui("Curved down arrow"),
  stripedRightArrow: () => ui("Striped right arrow"),
  notchedRightArrow: () => ui("Notched right arrow"),
  homePlate: () => ui("Pentagon arrow"),
  chevron: () => ui("Chevron"),
  rightArrowCallout: () => ui("Right arrow callout"),
  downArrowCallout: () => ui("Down arrow callout"),
  leftArrowCallout: () => ui("Left arrow callout"),
  upArrowCallout: () => ui("Up arrow callout"),
  leftRightArrowCallout: () => ui("Left-right arrow callout"),
  quadArrowCallout: () => ui("Quad arrow callout"),
  circularArrow: () => ui("Circular arrow"),
  mathPlus: () => ui("Plus sign"),
  mathMinus: () => ui("Minus sign"),
  mathMultiply: () => ui("Multiplication sign"),
  mathDivide: () => ui("Division sign"),
  mathEqual: () => ui("Equal sign"),
  mathNotEqual: () => ui("Not equal sign"),
  flowChartProcess: () => ui("Flowchart: Process"),
  flowChartAlternateProcess: () => ui("Flowchart: Alternate process"),
  flowChartDecision: () => ui("Flowchart: Decision"),
  flowChartInputOutput: () => ui("Flowchart: Data"),
  flowChartPredefinedProcess: () => ui("Flowchart: Predefined process"),
  flowChartInternalStorage: () => ui("Flowchart: Internal storage"),
  flowChartDocument: () => ui("Flowchart: Document"),
  flowChartMultidocument: () => ui("Flowchart: Multidocument"),
  flowChartTerminator: () => ui("Flowchart: Terminator"),
  flowChartPreparation: () => ui("Flowchart: Preparation"),
  flowChartManualInput: () => ui("Flowchart: Manual input"),
  flowChartManualOperation: () => ui("Flowchart: Manual operation"),
  flowChartConnector: () => ui("Flowchart: Connector"),
  flowChartOffpageConnector: () => ui("Flowchart: Off-page connector"),
  flowChartPunchedCard: () => ui("Flowchart: Card"),
  flowChartPunchedTape: () => ui("Flowchart: Punched tape"),
  flowChartSummingJunction: () => ui("Flowchart: Summing junction"),
  flowChartOr: () => ui("Flowchart: Or"),
  flowChartCollate: () => ui("Flowchart: Collate"),
  flowChartSort: () => ui("Flowchart: Sort"),
  flowChartExtract: () => ui("Flowchart: Extract"),
  flowChartMerge: () => ui("Flowchart: Merge"),
  flowChartOnlineStorage: () => ui("Flowchart: Stored data"),
  flowChartDelay: () => ui("Flowchart: Delay"),
  flowChartMagneticTape: () => ui("Flowchart: Sequential access storage"),
  flowChartMagneticDisk: () => ui("Flowchart: Magnetic disk"),
  flowChartMagneticDrum: () => ui("Flowchart: Direct access storage"),
  flowChartDisplay: () => ui("Flowchart: Display"),
  irregularSeal1: () => ui("Explosion 1"),
  irregularSeal2: () => ui("Explosion 2"),
  ribbon2: () => ui("Up ribbon"),
  ribbon: () => ui("Down ribbon"),
  ellipseRibbon2: () => ui("Curved up ribbon"),
  ellipseRibbon: () => ui("Curved down ribbon"),
  verticalScroll: () => ui("Vertical scroll"),
  horizontalScroll: () => ui("Horizontal scroll"),
  wave: () => ui("Wave"),
  doubleWave: () => ui("Double wave"),
  wedgeRectCallout: () => ui("Rectangular callout"),
  wedgeRoundRectCallout: () => ui("Rounded rectangular callout"),
  wedgeEllipseCallout: () => ui("Oval callout"),
  cloudCallout: () => ui("Cloud callout"),
  actionButtonBackPrevious: () => ui("Action button: Back or previous"),
  actionButtonForwardNext: () => ui("Action button: Forward or next"),
  actionButtonBeginning: () => ui("Action button: Go to beginning"),
  actionButtonEnd: () => ui("Action button: Go to end"),
  actionButtonHome: () => ui("Action button: Go home"),
  actionButtonInformation: () => ui("Action button: Get information"),
  actionButtonReturn: () => ui("Action button: Go back"),
  actionButtonMovie: () => ui("Action button: Video"),
  actionButtonDocument: () => ui("Action button: Document"),
  actionButtonSound: () => ui("Action button: Sound"),
  actionButtonHelp: () => ui("Action button: Help"),
  actionButtonBlank: () => ui("Action button: Blank"),
}

/** "flowChartAlternateProcess" → "Flow chart alternate process", for presets without a name. */
function spelledOut(preset: string): string {
  const words = preset.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9])([A-Za-z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The shape's name as PowerPoint's gallery shows it, e.g. "Rounded rectangle" for `roundRect`. */
export function shapeName(preset: string): string {
  const named = SHAPE_NAMES[preset]
  if (named) return named()
  const star = /^star(\d+)$/.exec(preset)
  if (star) return uit`${star[1]!}-point star`
  const callout = /^(border|accent|accentBorder)?Callout(\d)$/i.exec(preset)
  if (callout) {
    const n = callout[2]!
    const kind = (callout[1] ?? '').toLowerCase()
    if (kind === 'border') return uit`Line callout ${n}`
    if (kind === 'accent') return uit`Line callout ${n} (accent bar)`
    if (kind === 'accentborder') return uit`Line callout ${n} (border and accent bar)`
    return uit`Line callout ${n} (no border)`
  }
  return spelledOut(preset)
}

/** The color slots of a theme as the picker shows them, in Office's order. */
export const THEME_SLOTS = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const
export type ThemeSlot = (typeof THEME_SLOTS)[number]

/** "Background 1", "Text 1", "Accent 1", as Office names theme colors. */
export function themeColorName(slot: string): string {
  if (slot === 'bg1') return ui("Background 1")
  if (slot === 'tx1') return ui("Text 1")
  if (slot === 'bg2') return ui("Background 2")
  if (slot === 'tx2') return ui("Text 2")
  const accent = /^accent(\d)$/.exec(slot)
  return accent ? uit`Accent ${accent[1]!}` : slot
}

/** Office's ten standard colors, with their names. */
export const STANDARD_COLORS: readonly { hex: string; name: () => string }[] = [
  { hex: 'C00000', name: () => ui("Dark red") },
  { hex: 'FF0000', name: () => ui("Red") },
  { hex: 'FFC000', name: () => ui("Orange") },
  { hex: 'FFFF00', name: () => ui("Yellow") },
  { hex: '92D050', name: () => ui("Light green") },
  { hex: '00B050', name: () => ui("Green") },
  { hex: '00B0F0', name: () => ui("Light blue") },
  { hex: '0070C0', name: () => ui("Blue") },
  { hex: '002060', name: () => ui("Dark blue") },
  { hex: '7030A0', name: () => ui("Purple") },
]

/** Text highlight colors as Word and PowerPoint list them. */
export const HIGHLIGHT_COLORS: readonly { hex: string; name: () => string }[] = [
  { hex: 'FFFF00', name: () => ui("Yellow") },
  { hex: '00FF00', name: () => ui("Bright green") },
  { hex: '00FFFF', name: () => ui("Turquoise") },
  { hex: 'FF00FF', name: () => ui("Pink") },
  { hex: '0000FF', name: () => ui("Blue") },
  { hex: 'FF0000', name: () => ui("Red") },
  { hex: '000080', name: () => ui("Dark blue") },
  { hex: '008080', name: () => ui("Teal") },
  { hex: '008000', name: () => ui("Green") },
  { hex: '800080', name: () => ui("Violet") },
  { hex: '800000', name: () => ui("Dark red") },
  { hex: '808000', name: () => ui("Dark yellow") },
  { hex: '808080', name: () => ui("Gray") },
  { hex: 'C0C0C0', name: () => ui("Light gray") },
  { hex: '000000', name: () => ui("Black") },
]

/** Line dashes (`a:prstDash`) and PowerPoint's names for them. */
export const DASHES: readonly { value: string; name: () => string }[] = [
  { value: 'solid', name: () => ui("Solid") },
  { value: 'sysDot', name: () => ui("Round dot") },
  { value: 'sysDash', name: () => ui("Square dot") },
  { value: 'dash', name: () => ui("Dash") },
  { value: 'dashDot', name: () => ui("Dash dot") },
  { value: 'lgDash', name: () => ui("Long dash") },
  { value: 'lgDashDot', name: () => ui("Long dash dot") },
  { value: 'lgDashDotDot', name: () => ui("Long dash dot dot") },
  { value: 'dot', name: () => ui("Dot") },
]
