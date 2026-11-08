import { strToU8, zipSync } from 'fflate'
import { CONTENT_TYPE, NEW_PART_NAMESPACES, REL } from './names.js'
import { openTag, type JmlElement } from './jsonml.js'

/**
 * The package of a new, blank document: Letter paper with one-inch margins, Calibri 11pt, and
 * the styles the toolbar offers (headings, title, quote, list paragraph, table grid, …).
 */

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function heading(level: number, size: number, color: string, before: number, after: number): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading${level}Char"/><w:uiPriority w:val="9"/>${level > 1 ? '<w:unhideWhenUsed/>' : ''}<w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/>${level >= 4 ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${color}" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
    + `<w:style w:type="character" w:customStyle="1" w:styleId="Heading${level}Char"><w:name w:val="Heading ${level} Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Heading${level}"/><w:uiPriority w:val="9"/><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:color w:val="${color}" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
}

/** Word's built-in Heading 1–6 (size in half points, accent1 shade, italic, space before in twips). */
const BUILT_IN_HEADINGS: Record<number, { size?: number; color: string; shade: string; italic?: boolean; before: number }> = {
  1: { size: 32, color: '2F5496', shade: 'BF', before: 240 },
  2: { size: 26, color: '2F5496', shade: 'BF', before: 40 },
  3: { size: 24, color: '1F3763', shade: '7F', before: 40 },
  4: { color: '2F5496', shade: 'BF', italic: true, before: 40 },
  5: { color: '2F5496', shade: 'BF', before: 40 },
  6: { color: '1F3763', shade: '7F', before: 40 },
}

/**
 * Word's definition of a built-in heading style and its linked character style, for documents
 * that lack it (heading shortcuts add it on first use, as Word does).
 */
export function builtInHeadingStyles(level: number, basedOn: string | undefined): JmlElement[] | undefined {
  const heading = BUILT_IN_HEADINGS[level]
  if (!heading) return undefined
  const fonts: JmlElement = ['w:rFonts', { 'w:asciiTheme': 'majorHAnsi', 'w:eastAsiaTheme': 'majorEastAsia', 'w:hAnsiTheme': 'majorHAnsi', 'w:cstheme': 'majorBidi' }]
  const runProperties = (): JmlElement => ['w:rPr', {}, structuredClone(fonts),
    ...(heading.italic ? [['w:i', {}], ['w:iCs', {}]] as JmlElement[] : []),
    ['w:color', { 'w:val': heading.color, 'w:themeColor': 'accent1', 'w:themeShade': heading.shade }],
    ...(heading.size ? [['w:sz', { 'w:val': String(heading.size) }], ['w:szCs', { 'w:val': String(heading.size) }]] as JmlElement[] : [])]
  const id = `Heading${level}`
  const base: JmlElement[] = basedOn ? [['w:basedOn', { 'w:val': basedOn }], ['w:next', { 'w:val': basedOn }]] : []
  return [
    ['w:style', { 'w:type': 'paragraph', 'w:styleId': id }, ['w:name', { 'w:val': `heading ${level}` }], ...base, ['w:link', { 'w:val': `${id}Char` }],
      ['w:uiPriority', { 'w:val': '9' }], ...(level > 1 ? [['w:unhideWhenUsed', {}]] as JmlElement[] : []), ['w:qFormat', {}],
      ['w:pPr', {}, ['w:keepNext', {}], ['w:keepLines', {}], ['w:spacing', { 'w:before': String(heading.before), 'w:after': '0' }], ['w:outlineLvl', { 'w:val': String(level - 1) }]],
      runProperties()],
    ['w:style', { 'w:type': 'character', 'w:customStyle': '1', 'w:styleId': `${id}Char` }, ['w:name', { 'w:val': `Heading ${level} Char` }],
      ['w:basedOn', { 'w:val': 'DefaultParagraphFont' }], ['w:link', { 'w:val': id }], ['w:uiPriority', { 'w:val': '9' }], runProperties()],
  ]
}

const STYLES = `${DECLARATION}<w:styles xmlns:w="${W}" xmlns:r="${REL.officeDocument.replace('/officeDocument', '')}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + heading(1, 32, '2F5496', 240, 0) + heading(2, 26, '2F5496', 40, 0) + heading(3, 24, '1F3763', 40, 0) + heading(4, 22, '2F5496', 40, 0)
  + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
  + '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/><w:rPr><w:color w:val="5A5A5A" w:themeColor="text1" w:themeTint="A5"/><w:spacing w:val="15"/><w:sz w:val="22"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="200"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040" w:themeColor="text1" w:themeTint="BF"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:uiPriority w:val="1"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
  + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>'
  + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
  + '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="440"/></w:pPr></w:style>'
  + '</w:styles>'

const THEME = `${DECLARATION}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

const SETTINGS = `${DECLARATION}<w:settings xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:endnotePr><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="en-US"/><w:decimalSymbol w:val="."/><w:listSeparator w:val=","/></w:settings>`

function notes(kind: 'footnote' | 'endnote'): string {
  const separator = (type: string, id: number, mark: string) => `<w:${kind} w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${mark}/></w:r></w:p></w:${kind}>`
  return `${DECLARATION}${openTag(`w:${kind}s`, NEW_PART_NAMESPACES)}${separator('separator', -1, 'separator')}${separator('continuationSeparator', 0, 'continuationSeparator')}</w:${kind}s>`
}

const DOCUMENT = `${DECLARATION}${openTag('w:document', NEW_PART_NAMESPACES)}<w:body><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`

const CONTENT_TYPES = `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPE.document}"/><Override PartName="/word/styles.xml" ContentType="${CONTENT_TYPE.styles}"/><Override PartName="/word/settings.xml" ContentType="${CONTENT_TYPE.settings}"/><Override PartName="/word/footnotes.xml" ContentType="${CONTENT_TYPE.footnotes}"/><Override PartName="/word/endnotes.xml" ContentType="${CONTENT_TYPE.endnotes}"/><Override PartName="/word/theme/theme1.xml" ContentType="${CONTENT_TYPE.theme}"/><Override PartName="/docProps/core.xml" ContentType="${CONTENT_TYPE.coreProperties}"/><Override PartName="/docProps/app.xml" ContentType="${CONTENT_TYPE.extendedProperties}"/></Types>`

const ROOT_RELS = `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.officeDocument}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`

const DOCUMENT_RELS = `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.styles}" Target="styles.xml"/><Relationship Id="rId2" Type="${REL.settings}" Target="settings.xml"/><Relationship Id="rId3" Type="${REL.footnotes}" Target="footnotes.xml"/><Relationship Id="rId4" Type="${REL.endnotes}" Target="endnotes.xml"/><Relationship Id="rId5" Type="${REL.theme}" Target="theme/theme1.xml"/></Relationships>`

const CORE = `${DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title></dc:title><dc:creator></dc:creator></cp:coreProperties>`

const APP = `${DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pulpo</Application></Properties>`

export function blankDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
    'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
    'word/styles.xml': strToU8(STYLES),
    'word/settings.xml': strToU8(SETTINGS),
    'word/footnotes.xml': strToU8(notes('footnote')),
    'word/endnotes.xml': strToU8(notes('endnote')),
    'word/theme/theme1.xml': strToU8(THEME),
    'docProps/core.xml': strToU8(CORE),
    'docProps/app.xml': strToU8(APP),
  })
}
