import { ui } from '@/i18n/ui'

/** The number format menu: common formats with an example of each. */
export const NUMBER_FORMATS: { label: () => string; code: string; example: string }[] = [
  { label: () => ui("Automatic"), code: 'General', example: '1000.12' },
  { label: () => ui("Plain text"), code: '@', example: 'abc' },
  { label: () => ui("Number"), code: '#,##0.00', example: '1,000.12' },
  { label: () => ui("Percent"), code: '0.00%', example: '10.12%' },
  { label: () => ui("Scientific"), code: '0.00E+00', example: '1.01E+03' },
  { label: () => ui("Accounting"), code: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', example: '$ 1,000.12' },
  { label: () => ui("Currency"), code: '"$"#,##0.00', example: '$1,000.12' },
  { label: () => ui("Currency rounded"), code: '"$"#,##0', example: '$1,000' },
  { label: () => ui("Date"), code: 'm/d/yyyy', example: '9/26/2008' },
  { label: () => ui("Long date"), code: 'dddd, mmmm d, yyyy', example: 'Friday, September 26, 2008' },
  { label: () => ui("Time"), code: 'h:mm:ss AM/PM', example: '3:59:00 PM' },
  { label: () => ui("Date time"), code: 'm/d/yyyy h:mm', example: '9/26/2008 15:59' },
  { label: () => ui("Duration"), code: '[h]:mm:ss', example: '24:01:00' },
  { label: () => ui("Fraction"), code: '# ?/?', example: '1000 1/8' },
]

