import { describe, expect, it } from 'vitest'
import { columnLabel, indexDelimited, parseDelimitedRow, sniffDelimiter } from './delimited.js'

const rows = (text: string, options?: Parameters<typeof indexDelimited>[1]) => {
  const table = indexDelimited(text, options)
  return Array.from({ length: table.rowCount }, (_, index) => table.row(index))
}

describe('indexDelimited', () => {
  it('parses RFC 4180: quoted delimiters, escaped quotes, and quoted line breaks', () => {
    const text = 'name,notes\r\n"Smith, Jo","said ""hi""\r\nthen left"\r\nplain,"x"\r\n'
    expect(rows(text)).toEqual([
      ['name', 'notes'],
      ['Smith, Jo', 'said "hi"\r\nthen left'],
      ['plain', 'x'],
    ])
  })

  it('accepts LF, CRLF, and bare CR line ends and skips blank lines', () => {
    expect(rows('a,b\n1,2\r\n3,4\r5,6\n\n\r\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']])
  })

  it('drops a byte order mark instead of keeping it in the first header', () => {
    expect(rows('﻿id,value\n1,2')[0]).toEqual(['id', 'value'])
  })

  it('keeps empty cells, including trailing ones', () => {
    expect(rows('a,,c,\n,,,')).toEqual([['a', '', 'c', ''], ['', '', '', '']])
  })

  it('treats quotes inside unquoted cells as text, as spreadsheets do', () => {
    expect(rows('size,label\n5" disk,"a"b\n')).toEqual([['size', 'label'], ['5" disk', 'ab']])
  })

  it('runs an unclosed quote to the end of the file without losing text', () => {
    const table = indexDelimited('a,b\n1,"open\n2,3')
    expect(table.rowCount).toBe(2)
    expect(table.row(1)).toEqual(['1', 'open\n2,3'])
  })

  it('reports the widest row and caps columns', () => {
    const table = indexDelimited('a,b\n1,2,3,4\n', { maxColumns: 3 })
    expect(table.columnCount).toBe(3)
    expect(table.sourceColumnCount).toBe(4)
    expect(table.row(1)).toEqual(['1', '2', '3'])
  })

  it('stops indexing at the row limit and says so', () => {
    const table = indexDelimited('a\n1\n2\n3\n', { delimiter: ',', maxRows: 2 })
    expect(table.rowCount).toBe(2)
    expect(table.truncated).toBe(true)
  })

  it('returns a row as written', () => {
    const table = indexDelimited('a,b\n"x, y",2\n')
    expect(table.rowText(1)).toBe('"x, y",2')
    expect(() => table.row(5)).toThrow(RangeError)
  })

  it('indexes 200k rows quickly and parses them on demand', () => {
    const lines = ['id,name,amount']
    for (let index = 0; index < 200_000; index += 1) lines.push(`${index},"Name ${index}, Jr.",${index * 3}`)
    const started = performance.now()
    const table = indexDelimited(lines.join('\n'))
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(table.rowCount).toBe(200_001)
    expect(table.row(199_999)).toEqual(['199998', 'Name 199998, Jr.', String(199_998 * 3)])
  })

  it('handles a hostile file of nothing but quotes and delimiters', () => {
    const text = '"'.repeat(10_001) + ','.repeat(5_000) + '\n'.repeat(1000)
    const table = indexDelimited(text)
    expect(table.rowCount).toBe(1)
    expect(indexDelimited(','.repeat(50_000)).columnCount).toBe(1_000)
  })
})

describe('findRows', () => {
  const table = indexDelimited('Name,City\nAda,London\n"Grace ""Amazing"" Hopper","New York, NY"\nAlan,london\n')

  it('finds rows by cell text, case-insensitively', () => {
    expect(table.findRows('london')).toEqual([1, 3])
    expect(table.findRows('NEW YORK')).toEqual([2])
    expect(table.findRows('nowhere')).toEqual([])
    expect(table.findRows('')).toEqual([])
  })

  it('matches unquoted cell values even when the query has quotes or delimiters', () => {
    expect(table.findRows('"Amazing"')).toEqual([2])
    expect(table.findRows('York, NY')).toEqual([2])
  })

  it('respects the limit', () => {
    expect(table.findRows('a', 2)).toEqual([0, 1])
  })
})

describe('sniffDelimiter', () => {
  it('finds semicolons in CSV files from decimal-comma locales', () => {
    expect(sniffDelimiter('Name;Price;Qty\nTea;1,50;2\nCake;3,20;1\n', ',')).toBe(';')
  })

  it('keeps the declared delimiter on ties and for single-column files', () => {
    expect(sniffDelimiter('a,b\n1,2\n', ',')).toBe(',')
    expect(sniffDelimiter('just one column\nanother\n', ',')).toBe(',')
    expect(sniffDelimiter('a\tb\n1\t2\n', '\t')).toBe('\t')
  })

  it('ignores delimiters inside quotes', () => {
    expect(sniffDelimiter('"a;b;c",d\n"e;f;g",h\n', ',')).toBe(',')
  })

  it('finds pipes and tabs in files named .csv', () => {
    expect(sniffDelimiter('a|b|c\n1|2|3\n', ',')).toBe('|')
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n', ',')).toBe('\t')
  })
})

describe('parseDelimitedRow', () => {
  it('splits a range of the text', () => {
    const text = 'xx"a,b",c|'
    expect(parseDelimitedRow(text, 2, text.length - 1, ',')).toEqual(['a,b', 'c'])
  })
})

describe('columnLabel', () => {
  it('counts like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
  })
})
