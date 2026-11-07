import { strToU8, zipSync } from 'fflate'

/**
 * A new, blank 16:9 deck in the default Office look (theme, one master, the common layouts, and a
 * title slide), built from strings so File > New needs no binary template.
 */

const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

function rels(entries: [type: string, target: string][]): string {
  return `${DECLARATION}<Relationships xmlns="${RELS_NS}">${entries
    .map(([type, target], index) => `<Relationship Id="rId${index + 1}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${target}"/>`)
    .join('')}</Relationships>`
}

const THEME = `${DECLARATION}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light" panose="020F0302020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`

function level(index: number, size: number, extra = ''): string {
  return `<a:lvl${index}pPr marL="${index === 1 ? 228600 : 228600 + (index - 1) * 457200}" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="${index === 1 ? 1000 : 500}"/></a:spcBef><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr>${extra}</a:lvl${index}pPr>`
}

function plainLevels(): string {
  return Array.from(
    { length: 9 },
    (_, index) =>
      `<a:lvl${index + 1}pPr marL="${index * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${index + 1}pPr>`,
  ).join('')
}

const TREE_START = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

function placeholder(id: number, name: string, ph: string, xfrm: [number, number, number, number] | undefined, body: string, bodyPr = '<a:bodyPr/>', lstStyle = '<a:lstStyle/>'): string {
  const transform = xfrm ? `<a:xfrm><a:off x="${xfrm[0]}" y="${xfrm[1]}"/><a:ext cx="${xfrm[2]}" cy="${xfrm[3]}"/></a:xfrm>` : ''
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr>${transform}</p:spPr><p:txBody>${bodyPr}${lstStyle}${body}</p:txBody></p:sp>`
}

const prompt = (text: string, lvl?: number) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ''}<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`
const MASTER_BODY = [prompt('Click to edit Master text styles'), prompt('Second level', 1), prompt('Third level', 2), prompt('Fourth level', 3), prompt('Fifth level', 4)].join('')
const DATE = '<a:p><a:fld id="{B4F3A5C1-6C1E-4D4B-9B2D-2C0B1F4E8A10}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>1/1/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>'
const SLIDE_NUMBER = '<a:p><a:fld id="{7C2E9A40-3F2B-4B8B-A3D5-6E7F80A1B2C3}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>'

function footers(firstId: number): string {
  const small = (algn: string) => `<a:lstStyle><a:lvl1pPr algn="${algn}"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>`
  return (
    placeholder(firstId, 'Date Placeholder', 'type="dt" sz="half" idx="10"', [838200, 6356350, 2743200, 365125], DATE, '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>', small('l')) +
    placeholder(firstId + 1, 'Footer Placeholder', 'type="ftr" sz="quarter" idx="11"', [4038600, 6356350, 4114800, 365125], '<a:p><a:endParaRPr lang="en-US"/></a:p>', '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>', small('ctr')) +
    placeholder(firstId + 2, 'Slide Number Placeholder', 'type="sldNum" sz="quarter" idx="12"', [8610600, 6356350, 2743200, 365125], SLIDE_NUMBER, '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>', small('r'))
  )
}

function master(layoutCount: number): string {
  const ids = Array.from({ length: layoutCount }, (_, index) => `<p:sldLayoutId id="${2147483649 + index}" r:id="rId${index + 1}"/>`).join('')
  return `${DECLARATION}<p:sldMaster ${NAMESPACES}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${TREE_START}${placeholder(2, 'Title Placeholder 1', 'type="title"', [838200, 365125, 10515600, 1325563], prompt('Click to edit Master title style'), '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr>')}${placeholder(3, 'Text Placeholder 2', 'type="body" idx="1"', [838200, 1825625, 10515600, 4351338], MASTER_BODY, '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr>')}${footers(4)}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${ids}</p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${level(1, 2800)}${level(2, 2400)}${level(3, 2000)}${level(4, 1800)}${level(5, 1800)}${level(6, 1800)}${level(7, 1800)}${level(8, 1800)}${level(9, 1800)}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${plainLevels()}</p:otherStyle></p:txStyles></p:sldMaster>`
}

interface LayoutSpec {
  name: string
  type: string
  shapes: string
}

const LAYOUTS: LayoutSpec[] = [
  {
    name: 'Title Slide',
    type: 'title',
    shapes:
      placeholder(2, 'Title 1', 'type="ctrTitle"', [1524000, 1122363, 9144000, 2387600], prompt('Click to edit Master title style'), '<a:bodyPr anchor="b"/>', '<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle>') +
      placeholder(3, 'Subtitle 2', 'type="subTitle" idx="1"', [1524000, 3602038, 9144000, 1655762], prompt('Click to edit Master subtitle style'), '<a:bodyPr/>', '<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>'),
  },
  {
    name: 'Title and Content',
    type: 'obj',
    shapes: placeholder(2, 'Title 1', 'type="title"', undefined, prompt('Click to edit Master title style')) + placeholder(3, 'Content Placeholder 2', 'idx="1"', undefined, MASTER_BODY),
  },
  {
    name: 'Section Header',
    type: 'secHead',
    shapes:
      placeholder(2, 'Title 1', 'type="title"', [831850, 1709738, 10515600, 2852737], prompt('Click to edit Master title style'), '<a:bodyPr anchor="b"/>', '<a:lstStyle><a:lvl1pPr><a:defRPr sz="6000"/></a:lvl1pPr></a:lstStyle>') +
      placeholder(3, 'Text Placeholder 2', 'type="body" idx="1"', [831850, 4589463, 10515600, 1500187], prompt('Click to edit Master text styles'), '<a:bodyPr/>', '<a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>'),
  },
  {
    name: 'Two Content',
    type: 'twoObj',
    shapes:
      placeholder(2, 'Title 1', 'type="title"', undefined, prompt('Click to edit Master title style')) +
      placeholder(3, 'Content Placeholder 2', 'sz="half" idx="1"', [838200, 1825625, 5181600, 4351338], MASTER_BODY) +
      placeholder(4, 'Content Placeholder 3', 'sz="half" idx="2"', [6172200, 1825625, 5181600, 4351338], MASTER_BODY),
  },
  { name: 'Title Only', type: 'titleOnly', shapes: placeholder(2, 'Title 1', 'type="title"', undefined, prompt('Click to edit Master title style')) },
  { name: 'Blank', type: 'blank', shapes: '' },
]

function layout(spec: LayoutSpec): string {
  return `${DECLARATION}<p:sldLayout ${NAMESPACES} type="${spec.type}" preserve="1"><p:cSld name="${spec.name}">${TREE_START}${spec.shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

const TITLE_SLIDE = `${DECLARATION}<p:sld ${NAMESPACES}><p:cSld>${TREE_START}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

const PML = 'application/vnd.openxmlformats-officedocument.presentationml'

/** The bytes of a new blank presentation. */
export function blankPresentation(): Uint8Array {
  const layoutCount = LAYOUTS.length
  const files: Record<string, Uint8Array> = {}
  const add = (path: string, xml: string) => (files[path] = strToU8(xml))
  add(
    '[Content_Types].xml',
    `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="${PML}.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PML}.slideMaster+xml"/>${LAYOUTS.map((_, index) => `<Override PartName="/ppt/slideLayouts/slideLayout${index + 1}.xml" ContentType="${PML}.slideLayout+xml"/>`).join('')}<Override PartName="/ppt/slides/slide1.xml" ContentType="${PML}.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="${PML}.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="${PML}.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="${PML}.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  )
  add(
    '_rels/.rels',
    rels([
      ['officeDocument', 'ppt/presentation.xml'],
      ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['extended-properties', 'docProps/app.xml'],
    ]),
  )
  add(
    'docProps/core.xml',
    `${DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Presentation</dc:title></cp:coreProperties>`,
  )
  add(
    'docProps/app.xml',
    `${DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Pulpo</Application><PresentationFormat>Widescreen</PresentationFormat></Properties>`,
  )
  add(
    'ppt/presentation.xml',
    `${DECLARATION}<p:presentation ${NAMESPACES} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${plainLevels()}</p:defaultTextStyle></p:presentation>`,
  )
  add(
    'ppt/_rels/presentation.xml.rels',
    rels([
      ['slideMaster', 'slideMasters/slideMaster1.xml'],
      ['slide', 'slides/slide1.xml'],
      ['theme', 'theme/theme1.xml'],
      ['presProps', 'presProps.xml'],
      ['viewProps', 'viewProps.xml'],
      ['tableStyles', 'tableStyles.xml'],
    ]),
  )
  add('ppt/presProps.xml', `${DECLARATION}<p:presentationPr ${NAMESPACES}/>`)
  add('ppt/viewProps.xml', `${DECLARATION}<p:viewPr ${NAMESPACES}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`)
  add('ppt/tableStyles.xml', `${DECLARATION}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  add('ppt/theme/theme1.xml', THEME)
  add('ppt/slideMasters/slideMaster1.xml', master(layoutCount))
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([...LAYOUTS.map((_, index): [string, string] => ['slideLayout', `../slideLayouts/slideLayout${index + 1}.xml`]), ['theme', '../theme/theme1.xml']]))
  LAYOUTS.forEach((spec, index) => {
    add(`ppt/slideLayouts/slideLayout${index + 1}.xml`, layout(spec))
    add(`ppt/slideLayouts/_rels/slideLayout${index + 1}.xml.rels`, rels([['slideMaster', '../slideMasters/slideMaster1.xml']]))
  })
  add('ppt/slides/slide1.xml', TITLE_SLIDE)
  add('ppt/slides/_rels/slide1.xml.rels', rels([['slideLayout', '../slideLayouts/slideLayout1.xml']]))
  return zipSync(files)
}
