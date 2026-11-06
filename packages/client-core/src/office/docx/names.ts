/** Namespaces, content types, relationship types, and element orders of WordprocessingML. */

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export const REL = {
  officeDocument: `${REL_TYPE}/officeDocument`,
  styles: `${REL_TYPE}/styles`,
  numbering: `${REL_TYPE}/numbering`,
  settings: `${REL_TYPE}/settings`,
  theme: `${REL_TYPE}/theme`,
  header: `${REL_TYPE}/header`,
  footer: `${REL_TYPE}/footer`,
  footnotes: `${REL_TYPE}/footnotes`,
  endnotes: `${REL_TYPE}/endnotes`,
  comments: `${REL_TYPE}/comments`,
  commentsExtended: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
  commentsIds: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
  commentsExtensible: 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
  people: 'http://schemas.microsoft.com/office/2011/relationships/people',
  image: `${REL_TYPE}/image`,
  hyperlink: `${REL_TYPE}/hyperlink`,
  fontTable: `${REL_TYPE}/fontTable`,
} as const

const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml'
export const CONTENT_TYPE = {
  document: `${WML}.document.main+xml`,
  template: `${WML}.template.main+xml`,
  macroDocument: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  macroTemplate: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
  styles: `${WML}.styles+xml`,
  numbering: `${WML}.numbering+xml`,
  settings: `${WML}.settings+xml`,
  header: `${WML}.header+xml`,
  footer: `${WML}.footer+xml`,
  footnotes: `${WML}.footnotes+xml`,
  endnotes: `${WML}.endnotes+xml`,
  comments: `${WML}.comments+xml`,
  commentsExtended: `${WML}.commentsExtended+xml`,
  commentsIds: `${WML}.commentsIds+xml`,
  commentsExtensible: `${WML}.commentsExtensible+xml`,
  fontTable: `${WML}.fontTable+xml`,
  webSettings: `${WML}.webSettings+xml`,
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  coreProperties: 'application/vnd.openxmlformats-package.core-properties+xml',
  extendedProperties: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const

export const MIME_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  dotm: 'application/vnd.ms-word.template.macroEnabled.12',
} as const

/**
 * The prefixes Word declares on its parts. A part that ends up holding an element with one of
 * these prefixes (pasted from another story, say) gets the declaration it needs on export.
 */
export const KNOWN_NAMESPACES: Record<string, string> = {
  wpc: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  cx: 'http://schemas.microsoft.com/office/drawing/2014/chartex',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  aink: 'http://schemas.microsoft.com/office/drawing/2016/ink',
  am3d: 'http://schemas.microsoft.com/office/drawing/2017/model3d',
  o: 'urn:schemas-microsoft-com:office:office',
  oel: 'http://schemas.microsoft.com/office/2019/extlst',
  r: R_NS,
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  v: 'urn:schemas-microsoft-com:vml',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  w10: 'urn:schemas-microsoft-com:office:word',
  w: W_NS,
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16: 'http://schemas.microsoft.com/office/word/2018/wordml',
  w16du: 'http://schemas.microsoft.com/office/word/2023/wordml/word16du',
  w16sdtdh: 'http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash',
  w16se: 'http://schemas.microsoft.com/office/word/2015/wordml/symex',
  wpg: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  wpi: 'http://schemas.microsoft.com/office/word/2010/wordprocessingInk',
  wne: 'http://schemas.microsoft.com/office/word/2006/wordml',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
}

/** The declarations of a part Pulpo writes from scratch. */
export const NEW_PART_NAMESPACES: Record<string, string> = {
  'xmlns:wpc': KNOWN_NAMESPACES.wpc!,
  'xmlns:mc': KNOWN_NAMESPACES.mc!,
  'xmlns:o': KNOWN_NAMESPACES.o!,
  'xmlns:r': R_NS,
  'xmlns:m': KNOWN_NAMESPACES.m!,
  'xmlns:v': KNOWN_NAMESPACES.v!,
  'xmlns:wp14': KNOWN_NAMESPACES.wp14!,
  'xmlns:wp': KNOWN_NAMESPACES.wp!,
  'xmlns:w10': KNOWN_NAMESPACES.w10!,
  'xmlns:w': W_NS,
  'xmlns:w14': KNOWN_NAMESPACES.w14!,
  'xmlns:w15': KNOWN_NAMESPACES.w15!,
  'xmlns:wpg': KNOWN_NAMESPACES.wpg!,
  'xmlns:wpi': KNOWN_NAMESPACES.wpi!,
  'xmlns:wne': KNOWN_NAMESPACES.wne!,
  'xmlns:wps': KNOWN_NAMESPACES.wps!,
  'mc:Ignorable': 'w14 w15 wp14',
}

/** Child order of `w:rPr` (CT_RPr / CT_ParaRPr). Unknown children follow, then the change record. */
export const RPR_ORDER = [
  'w:ins', 'w:del', 'w:moveFrom', 'w:moveTo',
  'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike',
  'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden',
  'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect',
  'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout',
  'w:specVanish', 'w:oMath',
]

/** Child order of `w:pPr` (CT_PPr). */
export const PPR_ORDER = [
  'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl', 'w:numPr',
  'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap',
  'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd',
  'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc',
  'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr',
  'w:sectPr', 'w:pPrChange',
]

/** Child order of `w:tblPr`. */
export const TBLPR_ORDER = [
  'w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize', 'w:tblStyleColBandSize',
  'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders', 'w:shd', 'w:tblLayout', 'w:tblCellMar',
  'w:tblLook', 'w:tblCaption', 'w:tblDescription', 'w:tblPrChange',
]

/** Child order of `w:trPr`. */
export const TRPR_ORDER = [
  'w:cnfStyle', 'w:divId', 'w:gridBefore', 'w:gridAfter', 'w:wBefore', 'w:wAfter', 'w:cantSplit', 'w:trHeight',
  'w:tblHeader', 'w:tblCellSpacing', 'w:jc', 'w:hidden', 'w:ins', 'w:del', 'w:trPrChange',
]

/** Child order of `w:tcPr`. */
export const TCPR_ORDER = [
  'w:cnfStyle', 'w:tcW', 'w:gridSpan', 'w:hMerge', 'w:vMerge', 'w:tcBorders', 'w:shd', 'w:noWrap', 'w:tcMar',
  'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark', 'w:headers', 'w:cellIns', 'w:cellDel',
  'w:cellMerge', 'w:tcPrChange',
]

/** Child order of `w:sectPr`. */
export const SECTPR_ORDER = [
  'w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr', 'w:type', 'w:pgSz', 'w:pgMar',
  'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols', 'w:formProt', 'w:vAlign', 'w:noEndnote',
  'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid', 'w:printerSettings', 'w:sectPrChange',
]

/** Child order of `w:settings` (CT_Settings), for the few settings Pulpo writes. */
export const SETTINGS_ORDER = [
  'w:writeProtection', 'w:view', 'w:zoom', 'w:removePersonalInformation', 'w:removeDateAndTime',
  'w:doNotDisplayPageBoundaries', 'w:displayBackgroundShape', 'w:printPostScriptOverText',
  'w:printFractionalCharacterWidth', 'w:printFormsData', 'w:embedTrueTypeFonts', 'w:embedSystemFonts',
  'w:saveSubsetFonts', 'w:saveFormsData', 'w:mirrorMargins', 'w:alignBordersAndEdges',
  'w:bordersDoNotSurroundHeader', 'w:bordersDoNotSurroundFooter', 'w:gutterAtTop', 'w:hideSpellingErrors',
  'w:hideGrammaticalErrors', 'w:activeWritingStyle', 'w:proofState', 'w:formsDesign', 'w:attachedTemplate',
  'w:linkStyles', 'w:stylePaneFormatFilter', 'w:stylePaneSortMethod', 'w:documentType', 'w:mailMerge',
  'w:revisionView', 'w:trackRevisions', 'w:doNotTrackMoves', 'w:doNotTrackFormatting', 'w:documentProtection',
  'w:autoFormatOverride', 'w:styleLockTheme', 'w:styleLockQFSet', 'w:defaultTabStop', 'w:autoHyphenation',
  'w:consecutiveHyphenLimit', 'w:hyphenationZone', 'w:doNotHyphenateCaps', 'w:showEnvelope',
  'w:summaryLength', 'w:clickAndTypeStyle', 'w:defaultTableStyle', 'w:evenAndOddHeaders',
  'w:bookFoldRevPrinting', 'w:bookFoldPrinting', 'w:bookFoldPrintingSheets',
  'w:drawingGridHorizontalSpacing', 'w:drawingGridVerticalSpacing', 'w:displayHorizontalDrawingGridEvery',
  'w:displayVerticalDrawingGridEvery', 'w:doNotUseMarginsForDrawingGridOrigin',
  'w:drawingGridHorizontalOrigin', 'w:drawingGridVerticalOrigin', 'w:doNotShadeFormData', 'w:noPunctuationKerning',
  'w:characterSpacingControl', 'w:printTwoOnOne', 'w:strictFirstAndLastChars', 'w:noLineBreaksAfter',
  'w:noLineBreaksBefore', 'w:savePreviewPicture', 'w:doNotValidateAgainstSchema', 'w:saveInvalidXml',
  'w:ignoreMixedContent', 'w:alwaysShowPlaceholderText', 'w:doNotDemarcateInvalidXml', 'w:saveXmlDataOnly',
  'w:useXSLTWhenSaving', 'w:saveThroughXslt', 'w:showXMLTags', 'w:alwaysMergeEmptyNamespace', 'w:updateFields',
  'w:hdrShapeDefaults', 'w:footnotePr', 'w:endnotePr', 'w:compat', 'w:docVars', 'w:rsids', 'm:mathPr',
  'w:attachedSchema', 'w:themeFontLang', 'w:clrSchemeMapping', 'w:doNotIncludeSubdocsInStats',
  'w:doNotAutoCompressPictures', 'w:forceUpgrade', 'w:captions', 'w:readModeInkLockDown', 'w:smartTagType',
  'sl:schemaLibrary', 'w:shapeDefaults', 'w:doNotEmbedSmartTags', 'w:decimalSymbol', 'w:listSeparator',
]

/** Sorts property children into schema order: known names by `order`, unknown ones after, `tail` names last. */
export function sortByOrder<T extends [string, ...unknown[]]>(children: T[], order: readonly string[], tail: readonly string[] = []): T[] {
  const rank = (name: string) => {
    const tailIndex = tail.indexOf(name)
    if (tailIndex >= 0) return 10_000 + tailIndex
    const index = order.indexOf(name)
    return index < 0 ? 5_000 : index
  }
  return children
    .map((child, index) => ({ child, index, rank: rank(child[0]) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.child)
}
