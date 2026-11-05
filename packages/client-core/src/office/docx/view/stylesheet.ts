import { cssIdent, cssText, mergeCss, paragraphPropertiesCss, runPropertiesCss, type CssProps, type ThemeInfo } from '../css.js'
import type { JmlElement } from '../jsonml.js'
import { TABLE_CONDITIONS, type PropertyMap, type StyleSheet } from '../styles.js'

/**
 * The CSS a document's styles turn into. Every rule is scoped to the editor's root class so two
 * documents on one page do not share styles. Precedence follows Word: document defaults on the
 * root, then the paragraph style class, then table-style conditions on cells (which paragraph
 * styles override, as in Word), then character style spans, then direct formatting inline.
 */

function elements(map: PropertyMap, skip: readonly string[] = []): JmlElement[] {
  return [...map.entries()].filter(([name]) => !skip.includes(name)).map(([, element]) => element)
}

/** Paragraph properties numbering and layout handle themselves. */
const PARAGRAPH_SKIP = ['w:numPr', 'w:sectPr', 'w:rPr', 'w:pPrChange', 'w:pStyle']

function ruleBody(pPr: PropertyMap | undefined, rPr: PropertyMap | undefined, theme?: ThemeInfo): string {
  const props: CssProps = {}
  if (pPr) mergeCss(props, paragraphPropertiesCss(elements(pPr, PARAGRAPH_SKIP), theme))
  if (rPr) mergeCss(props, runPropertiesCss(['w:rPr', {}, ...elements(rPr)], theme))
  return cssText(props)
}

export function themeVariables(theme: ThemeInfo | undefined): string {
  if (!theme) return ''
  const vars: string[] = []
  for (const [name, color] of Object.entries(theme.colors)) vars.push(`--docx-theme-${name}:${color}`)
  if (theme.fonts.major) vars.push(`--docx-font-major:"${theme.fonts.major.replace(/"/g, '')}"`)
  if (theme.fonts.minor) vars.push(`--docx-font-minor:"${theme.fonts.minor.replace(/"/g, '')}"`)
  return vars.join(';')
}

export function documentStylesheet(scope: string, styles: StyleSheet, theme?: ThemeInfo): string {
  const rules: string[] = []
  const root = `.${scope}`
  // Document defaults go on every flow (body, headers, notes), above the base rules' fallbacks.
  rules.push(`${root}{${themeVariables(theme)}}`)
  rules.push(`${root} .docx-flow{${ruleBody(undefined, styles.docDefaults.rPr, theme)}}`)
  rules.push(`${root} .docx-p{${ruleBody(styles.docDefaults.pPr, undefined, theme)}}`)
  // Table styles first: Word applies them above the document defaults but below paragraph and
  // character styles. Run formatting inherits from the cell; paragraph formatting (spacing and
  // indents, which do not inherit) targets the cell's paragraphs at paragraph-style specificity.
  for (const style of styles.styles.values()) {
    if (style.type !== 'table') continue
    const resolved = styles.resolve(style.id)
    const id = cssIdent(style.id)
    const conditions = [['base', resolved.pPr, resolved.rPr] as const, ...TABLE_CONDITIONS.map((condition) => {
      const set = tableConditionChain(styles, style.id, condition)
      return [condition, set.pPr, set.rPr] as const
    })]
    for (const [name, pPr, rPr] of conditions) {
      const runs = ruleBody(undefined, rPr, theme)
      const paragraphs = ruleBody(pPr, undefined, theme)
      if (runs) rules.push(`${root} .docx-tc-${id}-${name}{${runs}}`)
      if (paragraphs) rules.push(`${root} :where(.docx-tc-${id}-${name}) .docx-p{${paragraphs}}`)
    }
  }
  const defaultParagraph = styles.defaultStyle('paragraph')
  for (const style of styles.styles.values()) {
    const resolved = styles.resolve(style.id)
    const id = cssIdent(style.id)
    if (style.type === 'paragraph') {
      // Only what the style chain itself sets, so table styles underneath still show through.
      const own = style === defaultParagraph ? { pPr: new Map(), rPr: resolved.rPr } : resolved
      const body = ruleBody(own.pPr, own.rPr, theme)
      const selectors = [`${root} .docx-ps-${id}`]
      if (style === defaultParagraph) selectors.push(`${root} .docx-ps--default`)
      if (body) rules.push(`${selectors.join(',')}{${body}}`)
      // The default style's paragraph properties sit with the document defaults, below table styles.
      if (style === defaultParagraph) {
        const paragraphs = ruleBody(resolved.pPr, undefined, theme)
        if (paragraphs) rules.splice(3, 0, `${root} .docx-p:where(.docx-ps-${id},.docx-ps--default){${paragraphs}}`)
      }
    } else if (style.type === 'character') {
      const body = ruleBody(undefined, resolved.rPr, theme)
      if (body) rules.push(`${root} .docx-cs-${id}{${body}}`)
    }
  }
  return rules.join('\n')
}

/** A table style condition's properties with what its base styles say for it. */
export function tableConditionChain(styles: StyleSheet, id: string, condition: (typeof TABLE_CONDITIONS)[number]) {
  const pPr: PropertyMap = new Map()
  const rPr: PropertyMap = new Map()
  const tcPr: PropertyMap = new Map()
  const tblPr: PropertyMap = new Map()
  for (const style of styles.chain(id)) {
    const set = style.conditions.get(condition)
    if (!set) continue
    for (const [target, source] of [[pPr, set.pPr], [rPr, set.rPr], [tcPr, set.tcPr], [tblPr, set.tblPr]] as const) {
      if (source) for (const child of source.slice(2) as JmlElement[]) if (Array.isArray(child)) target.set(child[0], child)
    }
  }
  return { pPr, rPr, tcPr, tblPr }
}

/** Layout rules every document shares. */
export const DOCX_BASE_CSS = `
.docx-flow,.docx-flow .docx-wrapper{display:flex;flex-direction:column}
.docx-flow>*,.docx-flow .docx-wrapper>*{align-self:stretch;flex:none}
.docx-flow>table.docx-table,.docx-flow .docx-wrapper>table.docx-table{align-self:flex-start}
.docx-flow{position:relative;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;color:#000;font-family:Carlito,Calibri,"Liberation Sans",Arial,sans-serif;font-size:11pt;outline:none;font-kerning:normal;text-rendering:optimizeLegibility;caret-color:#000;-webkit-font-smoothing:antialiased}
.docx-flow .docx-p,.docx-flow .docx-p span{line-height:max(var(--docx-lh-min,0pt),var(--docx-lh-abs,calc(var(--docx-lh,1)*var(--docx-flh,1.17)*1em)))}
.docx-flow .docx-p{margin:0 calc(var(--docx-ind-r,0pt) + var(--docx-sec-inset,0px)) 0 var(--docx-ind-l,0pt);min-height:1em;position:relative}
.docx-flow td.docx-cell{--docx-sec-inset:0px}
.docx-flow .docx-p[data-label]::before{content:attr(data-label);display:inline-block;min-width:var(--docx-label-w,0);text-indent:0;font-family:var(--docx-label-font,inherit);font-weight:var(--docx-label-weight,inherit);font-style:normal;color:var(--docx-label-color,inherit);font-size:var(--docx-label-size,inherit);text-decoration:none;white-space:pre;box-sizing:border-box;text-align:var(--docx-label-align,left)}
.docx-flow .docx-p[data-label-suffix="space"]::before{min-width:0;padding-right:0.3em}
.docx-flow .docx-p[data-label-suffix="nothing"]::before{min-width:0}
.docx-flow .docx-hidden{display:none}
.docx-flow .docx-tab{white-space:pre;display:inline-block;min-width:1px;tab-size:var(--docx-tab-size,36pt)}
.docx-flow .docx-tab[data-leader="dot"]{background:radial-gradient(circle,currentColor 0.6px,transparent 0.9px) 0 calc(100% - 0.25em)/4px 4px repeat-x}
.docx-flow .docx-tab[data-leader="hyphen"]{background:linear-gradient(currentColor,currentColor) 0 calc(100% - 0.4em)/100% 1px no-repeat}
.docx-flow .docx-tab[data-leader="underscore"],.docx-flow .docx-tab[data-leader="heavy"]{border-bottom:1px solid currentColor}
.docx-flow .docx-tab[data-leader="middleDot"]{background:radial-gradient(circle,currentColor 0.6px,transparent 0.9px) 0 55%/4px 4px repeat-x}
.docx-flow .docx-page-break,.docx-flow .docx-column-break{display:block;height:0;border-top:1px dashed var(--docx-mark-color,#9aa0a6);margin:4pt 0}
.docx-paginated .docx-flow .docx-page-break,.docx-paginated .docx-flow .docx-column-break{border-top:none;margin:0}
.docx-flow .docx-noteref::after{content:attr(data-label)}
.docx-flow .docx-noteref{font-size:65%;vertical-align:super;line-height:0}
.docx-flow .docx-sym{white-space:pre}
.docx-flow .docx-drawing{display:inline-block;vertical-align:bottom;position:relative;max-width:100%}
.docx-flow .docx-drawing img{width:100%;height:100%;display:block;user-select:none;-webkit-user-drag:none}
.docx-flow .docx-drawing[data-placeholder]{background:repeating-linear-gradient(45deg,#f1f3f4,#f1f3f4 6px,#e8eaed 6px,#e8eaed 12px);outline:1px solid #dadce0;color:#5f6368;font:9pt system-ui,sans-serif;overflow:hidden;text-align:center}
.docx-flow .docx-drawing[data-placeholder]>.docx-drawing-text{display:block;padding:4pt;white-space:pre-wrap;text-align:left;color:#202124;font:inherit}
.docx-flow .docx-drawing.ProseMirror-selectednode{outline:2px solid #1a73e8}
.docx-flow .docx-anchor{display:inline;width:0;height:0;position:static}
.docx-flow .docx-anchor>.docx-float{position:absolute;z-index:1}
.docx-flow .docx-anchor>.docx-float[data-behind]{z-index:-1}
.docx-flow .docx-anchor>.docx-float[data-float="left"]{position:relative;float:left;margin-right:9pt}
.docx-flow .docx-anchor>.docx-float[data-float="right"]{position:relative;float:right;margin-left:9pt}
.docx-flow .docx-math{display:inline-block;vertical-align:middle}
.docx-flow .docx-math math{font-family:"Cambria Math","Latin Modern Math","STIX Two Math",math;font-size:1.05em}
.docx-flow .docx-math[data-display]{display:block;text-align:center;margin:2pt 0}
.docx-flow .docx-opaque-inline{display:inline-block;min-width:8px;height:1em;vertical-align:middle;border-bottom:1px dotted var(--docx-mark-color,#9aa0a6)}
.docx-flow .docx-opaque-inline[data-name="w:noBreakHyphen"]::after{content:"\\2011"}
.docx-flow .docx-opaque-inline[data-name="w:noBreakHyphen"],.docx-flow .docx-opaque-inline[data-name="w:softHyphen"],.docx-flow .docx-opaque-inline[data-name="w:ptab"],.docx-flow .docx-opaque-inline[data-name="w:footnoteRef"],.docx-flow .docx-opaque-inline[data-name="w:endnoteRef"],.docx-flow .docx-opaque-inline[data-name="w:separator"],.docx-flow .docx-opaque-inline[data-name="w:continuationSeparator"],.docx-flow .docx-opaque-inline[data-name="w:annotationRef"],.docx-flow .docx-opaque-inline[data-name^="w:perm"],.docx-flow .docx-opaque-inline[data-name^="w:moveFromRange"],.docx-flow .docx-opaque-inline[data-name^="w:moveToRange"],.docx-flow .docx-opaque-inline[data-name^="w:customXml"]{border:none;min-width:0;height:auto}
.docx-flow .docx-opaque-inline[data-name="w:footnoteRef"]::after,.docx-flow .docx-opaque-inline[data-name="w:endnoteRef"]::after{content:attr(data-label);font-size:65%;vertical-align:super}
.docx-flow .docx-opaque-block{min-height:12pt;border:1px dashed var(--docx-mark-color,#9aa0a6);margin:2pt 0;color:#5f6368;font:9pt system-ui,sans-serif;padding:2pt 4pt}
.docx-flow .docx-opaque-block::before{content:var(--docx-opaque-label,"Embedded content")}
.docx-flow .docx-wrapper-sdt{outline:1px solid transparent;border-radius:2px}
.docx-flow .docx-wrapper-sdt:hover,.docx-flow .docx-sdt:hover{outline:1px solid #bdc1c6;background:rgb(0 0 0 / 0.02)}
.docx-flow .docx-link{color:inherit;text-decoration:inherit;cursor:text}
.docx-flow .docx-ins,.docx-flow .docx-move-to{text-decoration:underline;text-decoration-color:var(--docx-rev-color,#188038);color:var(--docx-rev-color,#188038)}
.docx-flow .docx-del,.docx-flow .docx-move-from{text-decoration:line-through;text-decoration-color:var(--docx-rev-color,#c5221f);color:var(--docx-rev-color,#c5221f)}
.docx-flow .docx-move-to{text-decoration-style:double}
.docx-flow .docx-move-from{text-decoration-style:double}
.docx-flow .docx-format-change{border-bottom:1px dotted #9334e6}
.docx-flow.docx-final .docx-del,.docx-flow.docx-final .docx-move-from{display:none}
.docx-flow.docx-final .docx-ins,.docx-flow.docx-final .docx-move-to{color:inherit;text-decoration:inherit}
.docx-flow .docx-p[data-para-rev="ins"]::after{content:"\\00b6";color:var(--docx-rev-color,#188038);font-size:0.8em}
.docx-flow .docx-p[data-para-rev="del"]::after{content:"\\00b6";color:var(--docx-rev-color,#c5221f);text-decoration:line-through;font-size:0.8em}
.docx-flow .docx-p[data-rev-bar]{box-shadow:inset 2px 0 0 #9aa0a6}
.docx-flow .docx-comment-range{background:rgb(251 188 4 / 0.25);border-bottom:2px solid rgb(251 188 4 / 0.6)}
.docx-flow .docx-comment-range[data-active]{background:rgb(251 188 4 / 0.55)}
.docx-flow .docx-comment-range[data-resolved]{background:transparent;border-bottom-color:transparent}
.docx-flow .docx-find-match{background:rgb(255 213 0 / 0.55);border-radius:1px}
.docx-flow .docx-find-current{background:rgb(255 150 0 / 0.75)}
.docx-flow .docx-spell{}
.docx-flow table.docx-table{border-collapse:collapse;border-spacing:0;table-layout:auto;margin-top:0;margin-bottom:0;position:relative}
.docx-flow table.docx-table td.docx-cell{padding:0 5.4pt;vertical-align:top;position:relative;box-sizing:border-box;min-width:4pt}
.docx-flow table.docx-table td[data-phantom]{border:none!important;background:transparent!important;padding:0!important;pointer-events:none;visibility:hidden}
.docx-flow table.docx-table td.selectedCell{background-image:linear-gradient(rgb(26 115 232 / 0.18),rgb(26 115 232 / 0.18))}
.docx-flow .docx-page-spacer{display:block;pointer-events:none;user-select:none}
.docx-flow td.docx-row-spacer::before{content:"";display:block;height:var(--docx-row-spacer,0)}
.docx-flow.ProseMirror-hideselection *::selection{background:transparent}
.docx-flow .ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute}
.docx-flow .ProseMirror-gapcursor:after{content:"";display:block;position:absolute;top:-2px;width:20px;border-top:1px solid black;animation:ProseMirror-cursor-blink 1.1s steps(2,start) infinite}
@keyframes ProseMirror-cursor-blink{to{visibility:hidden}}
.docx-flow.ProseMirror-focused .ProseMirror-gapcursor{display:block}
.docx-flow .collaboration-carets__caret,.docx-flow .ProseMirror-yjs-cursor{position:relative;margin-left:-1px;margin-right:-1px;border-left:1px solid;border-right:1px solid;word-break:normal;pointer-events:none}
.docx-flow .ProseMirror-yjs-cursor>div{position:absolute;top:-1.15em;left:-1px;font:600 9px/1.2 system-ui,sans-serif;white-space:nowrap;color:#fff;padding:1px 4px;border-radius:3px 3px 3px 0;user-select:none;pointer-events:none}
.docx-flow .ProseMirror-yjs-selection{border-radius:1px}
.docx-editor{position:relative;--docx-page-gap:16px}
.docx-canvas{position:relative;margin:0 auto;transform-origin:top center}
.docx-pages,.docx-bands{position:absolute;inset:0;pointer-events:none}
.docx-pages{z-index:0}
.docx-bands{z-index:2}
.docx-page{position:absolute;background:#fff;box-shadow:0 0 0 1px rgb(0 0 0 / 0.06),0 1px 3px rgb(0 0 0 / 0.16)}
.docx-band{position:absolute;background:#fff;overflow:hidden}
.docx-band-gap{position:absolute;background:var(--docx-desk,#f1f3f4)}
.docx-band .docx-story{position:absolute;color:#000;pointer-events:auto;cursor:default}
.docx-band .docx-story:hover{outline:1px dashed rgb(26 115 232 / 0.5);outline-offset:2pt}
.docx-band .docx-footnotes{position:absolute;color:#000;pointer-events:auto}
.docx-band .docx-footnotes::before{content:"";display:block;width:144pt;border-top:0.75pt solid #000;margin-bottom:3pt}
.docx-band .docx-story-label{position:absolute;font:600 9px/1 system-ui,sans-serif;color:#1a73e8;background:#e8f0fe;padding:2px 5px;border-radius:3px;pointer-events:none}
.docx-flow-host{position:absolute;z-index:1}
.docx-web .docx-flow-host{position:relative;margin:0 auto;padding:32px 24px 64px;background:#fff}
.docx-story-editor{position:absolute;z-index:3;background:#fff;outline:1.5px solid #1a73e8;outline-offset:2pt}
.docx-endnotes{margin-top:24pt;padding-top:6pt;border-top:0.75pt solid #000}
`
