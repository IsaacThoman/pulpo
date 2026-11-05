/**
 * Built-in number formats (ids a workbook can use without defining them) and Excel's default
 * color palette for `[ColorN]`.
 */

const DATE = 'm/d/yyyy'
const CURRENCY_0 = '"$"#,##0_);("$"#,##0)'
const CURRENCY_0_RED = '"$"#,##0_);[Red]("$"#,##0)'
const CURRENCY_2 = '"$"#,##0.00_);("$"#,##0.00)'
const CURRENCY_2_RED = '"$"#,##0.00_);[Red]("$"#,##0.00)'

/**
 * The en-US codes Excel uses. Ids 5–8 and 27–81 are locale-dependent in the file format; they map
 * to what an en-US Excel shows for them (the CJK and Thai variants fall back to their plain
 * equivalents).
 */
const BUILTIN: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: CURRENCY_0,
  6: CURRENCY_0_RED,
  7: CURRENCY_2,
  8: CURRENCY_2_RED,
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: DATE,
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm',
  23: 'General',
  24: 'General',
  25: 'General',
  26: 'General',
  27: DATE,
  28: DATE,
  29: DATE,
  30: DATE,
  31: DATE,
  32: 'h:mm',
  33: 'h:mm:ss',
  34: 'h:mm',
  35: 'h:mm:ss',
  36: DATE,
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
  50: DATE,
  51: DATE,
  52: DATE,
  53: DATE,
  54: DATE,
  55: DATE,
  56: DATE,
  57: DATE,
  58: DATE,
  59: '0',
  60: '0.00',
  61: '#,##0',
  62: '#,##0.00',
  63: CURRENCY_0,
  64: CURRENCY_0_RED,
  65: CURRENCY_2,
  66: CURRENCY_2_RED,
  67: '0%',
  68: '0.00%',
  69: '# ?/?',
  70: '# ??/??',
  71: DATE,
  72: DATE,
  73: 'd-mmm-yy',
  74: 'd-mmm',
  75: 'mmm-yy',
  76: 'h:mm',
  77: 'h:mm:ss',
  78: 'm/d/yyyy h:mm',
  79: 'mm:ss',
  80: '[h]:mm:ss',
  81: 'mmss.0',
}

/** The code of a built-in number format id (0–81), if any. Ids from 164 on are workbook-defined. */
export function builtinFormatCode(id: number): string | undefined {
  return BUILTIN[id]
}

export const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  green: '#00FF00',
  magenta: '#FF00FF',
  red: '#FF0000',
  white: '#FFFFFF',
  yellow: '#FFFF00',
}

/** Excel's default 56-color palette; `[Color1]` is the first entry. */
export const PALETTE = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
  '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
  '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
  '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99',
  '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696',
  '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333',
]
