/** The Office theme (2013–2022 colors, Calibri fonts) for workbooks created here. */
const SCHEME_COLORS: [string, string][] = [
  ['dk1', '<a:sysClr val="windowText" lastClr="000000"/>'],
  ['lt1', '<a:sysClr val="window" lastClr="FFFFFF"/>'],
  ['dk2', '<a:srgbClr val="44546A"/>'],
  ['lt2', '<a:srgbClr val="E7E6E6"/>'],
  ['accent1', '<a:srgbClr val="4472C4"/>'],
  ['accent2', '<a:srgbClr val="ED7D31"/>'],
  ['accent3', '<a:srgbClr val="A5A5A5"/>'],
  ['accent4', '<a:srgbClr val="FFC000"/>'],
  ['accent5', '<a:srgbClr val="5B9BD5"/>'],
  ['accent6', '<a:srgbClr val="70AD47"/>'],
  ['hlink', '<a:srgbClr val="0563C1"/>'],
  ['folHlink', '<a:srgbClr val="954F72"/>'],
]

const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
const line = (width: number) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`

export const DEFAULT_THEME_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>' +
  `<a:clrScheme name="Office">${SCHEME_COLORS.map(([name, color]) => `<a:${name}>${color}</a:${name}>`).join('')}</a:clrScheme>` +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light" panose="020F0302020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  `<a:fmtScheme name="Office"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>` +
  `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme>` +
  '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
