import { Errors } from '../types.js'
import { table } from './test-table.js'
import { arr, col, createContext, grid, ref, row, type TestContext } from './testing.js'

const data = (): TestContext =>
  createContext({
    cells: {
      // A1:C6 employees, sorted by id.
      ...grid([[101, 'Davis', 'Sara'], [102, 'Fontana', 'Olivier'], [103, 'Leal', 'Karina'], [104, 'Patten', 'Michael'], [105, 'Burke', 'Brian'], [106, 'Sousa', 'Luis']]),
      // E2:G10 density table from Microsoft's VLOOKUP documentation.
      ...grid(
        [[0.457, 3.55, 500], [0.525, 3.25, 400], [0.606, 2.93, 300], [0.675, 2.75, 250], [0.746, 2.57, 200], [0.835, 2.38, 15], [0.946, 2.17, 100], [1.09, 1.95, 50], [1.29, 1.71, 0]],
        'E2',
      ),
      // I1:K4 HLOOKUP table.
      ...grid([['Axles', 'Bearings', 'Bolts'], [4, 4, 9], [5, 7, 10], [6, 8, 11]], 'I1'),
      // M2:N6 LOOKUP vectors.
      ...grid([[4.14, 'red'], [4.19, 'orange'], [5.17, 'yellow'], [5.77, 'green'], [6.39, 'blue']], 'M2'),
      // P1:P4 MATCH data.
      ...grid([[25], [38], [40], [41]], 'P1'),
    },
  })

table('VLOOKUP / HLOOKUP', [
  ['VLOOKUP', [102, ref('A1:C6'), 2, false], 'Fontana'],
  ['VLOOKUP', [102.5, ref('A1:C6'), 2, true], 'Fontana'],
  ['VLOOKUP', [102.5, ref('A1:C6'), 2, false], Errors.NA],
  ['VLOOKUP', [100, ref('A1:C6'), 2], Errors.NA],
  ['VLOOKUP', [200, ref('A1:C6'), 3], 'Luis'],
  ['VLOOKUP', ['F*', ref('B1:C6'), 2, false], 'Olivier'],
  ['VLOOKUP', ['?eal', ref('B1:C6'), 2, false], 'Karina'],
  ['VLOOKUP', ['burke', ref('B1:C6'), 2, false], 'Brian'],
  ['VLOOKUP', ['102', ref('A1:C6'), 2, false], Errors.NA],
  ['VLOOKUP', [102, ref('A1:C6'), 4, false], Errors.REF],
  ['VLOOKUP', [102, ref('A1:C6'), 0, false], Errors.VALUE],
  ['VLOOKUP', [Errors.DIV0, ref('A1:C6'), 2], Errors.DIV0],
  ['VLOOKUP', [102, ref('A1:C6'), 2, undefined], 'Fontana'],
  ['VLOOKUP', [1, ref('E2:G10'), 2], 2.17],
  ['VLOOKUP', [1, ref('E2:G10'), 3, true], 100],
  ['VLOOKUP', [0.7, ref('E2:G10'), 3, false], Errors.NA],
  ['VLOOKUP', [0.1, ref('E2:G10'), 2, true], Errors.NA],
  ['VLOOKUP', [2, ref('E2:G10'), 2, true], 1.71],
  ['VLOOKUP', [col(101, 106), ref('A1:C6'), 2, false], [['Davis'], ['Sousa']]],
  ['HLOOKUP', ['Axles', ref('I1:K4'), 2, true], 4],
  ['HLOOKUP', ['Bearings', ref('I1:K4'), 3, false], 7],
  ['HLOOKUP', ['B', ref('I1:K4'), 3, true], 5],
  ['HLOOKUP', ['Bolts', ref('I1:K4'), 4], 11],
  ['HLOOKUP', [3, arr([[1, 2, 3], ['a', 'b', 'c'], ['d', 'e', 'f']]), 2, true], 'c'],
  ['HLOOKUP', ['Bolts', ref('I1:K4'), 5], Errors.REF],
], data)

table('LOOKUP', [
  ['LOOKUP', [4.19, ref('M2:M6'), ref('N2:N6')], 'orange'],
  ['LOOKUP', [5.75, ref('M2:M6'), ref('N2:N6')], 'yellow'],
  ['LOOKUP', [7.66, ref('M2:M6'), ref('N2:N6')], 'blue'],
  ['LOOKUP', [0, ref('M2:M6'), ref('N2:N6')], Errors.NA],
  ['LOOKUP', [4.19, ref('M2:M6'), ref('N2')], 'orange'],
  ['LOOKUP', ['C', arr([['a', 'b', 'c', 'd'], [1, 2, 3, 4]])], 3],
  ['LOOKUP', ['bump', arr([['a', 1], ['b', 2], ['c', 3]])], 2],
  ['LOOKUP', [2, col(Errors.DIV0, 1, Errors.DIV0, 1, Errors.DIV0), col('a', 'b', 'c', 'd', 'e')], 'd'],
  ['LOOKUP', [9.99e307, col(1, 'x', 3, null, 'y')], 3],
  ['LOOKUP', ['zzz', col(1, 'x', 3, 'y', 5)], 'y'],
], data)

table('MATCH', [
  ['MATCH', [39, ref('P1:P4'), 1], 2],
  ['MATCH', [39, ref('P1:P4')], 2],
  ['MATCH', [41, ref('P1:P4'), 0], 4],
  ['MATCH', [40, ref('P1:P4'), -1], Errors.NA],
  ['MATCH', [24, ref('P1:P4')], Errors.NA],
  ['MATCH', [40, row(50, 41, 40, 25), -1], 3],
  ['MATCH', [42, row(50, 41, 40, 25), -1], 1],
  ['MATCH', [2, row(1, 2, 2, 2, 3), 1], 4],
  ['MATCH', [5, row(1, 7, 3, 4, 2), 1], 5],
  ['MATCH', ['b?', row('a1', 'b2', 'c3'), 0], 2],
  ['MATCH', ['B2', row('a1', 'b2'), 0], 2],
  ['MATCH', ['~*', row('a', '*'), 0], 2],
  ['MATCH', [1, row('1', 1), 0], 2],
  ['MATCH', [true, row(1, true), 0], 2],
  ['MATCH', ['b', row('a', 'c', 'e'), 1], 1],
  ['MATCH', [1, arr([[1, 2], [3, 4]]), 0], Errors.NA],
], data)

table('XLOOKUP / XMATCH', [
  ['XLOOKUP', ['b', col('a', 'b', 'c'), col(1, 2, 3)], 2],
  ['XLOOKUP', ['B', col('a', 'b', 'c'), col(1, 2, 3)], 2],
  ['XLOOKUP', ['z', col('a', 'b', 'c'), col(1, 2, 3)], Errors.NA],
  ['XLOOKUP', ['z', col('a', 'b', 'c'), col(1, 2, 3), 'nf'], 'nf'],
  ['XLOOKUP', ['z', col('a', 'b', 'c'), col(1, 2, 3), undefined, 0], Errors.NA],
  ['XLOOKUP', [2.5, col(1, 2, 3), col('a', 'b', 'c'), undefined, -1], 'b'],
  ['XLOOKUP', [2.5, col(1, 2, 3), col('a', 'b', 'c'), undefined, 1], 'c'],
  ['XLOOKUP', [2.5, col(3, 1, 2), col('a', 'b', 'c'), undefined, -1], 'c'],
  ['XLOOKUP', [0.5, col(1, 2, 3), col('a', 'b', 'c'), undefined, -1], Errors.NA],
  ['XLOOKUP', ['b*', col('apple', 'banana', 'blueberry'), col(1, 2, 3), undefined, 2], 2],
  ['XLOOKUP', ['b*', col('apple', 'banana', 'blueberry'), col(1, 2, 3), undefined, 2, -1], 3],
  ['XLOOKUP', ['b*', col('b*', 'banana'), col(1, 2)], 1],
  ['XLOOKUP', [3, col(1, 3, 5, 7), col('a', 'b', 'c', 'd'), undefined, 0, 2], 'b'],
  ['XLOOKUP', [4, col(1, 3, 5, 7), col('a', 'b', 'c', 'd'), undefined, -1, 2], 'b'],
  ['XLOOKUP', [4, col(1, 3, 5, 7), col('a', 'b', 'c', 'd'), undefined, 1, 2], 'c'],
  ['XLOOKUP', [4, col(1, 3, 5, 7), col('a', 'b', 'c', 'd'), undefined, 0, 2], Errors.NA],
  ['XLOOKUP', [4, col(7, 5, 3, 1), col('w', 'x', 'y', 'z'), undefined, -1, -2], 'y'],
  ['XLOOKUP', [4, col(7, 5, 3, 1), col('w', 'x', 'y', 'z'), undefined, 1, -2], 'x'],
  ['XLOOKUP', [8, col(1, 3, 5, 7), col('a', 'b', 'c', 'd'), undefined, 1, 2], Errors.NA],
  ['XLOOKUP', ['b', col('a', 'b'), arr([[1, 2], [3, 4]])], [[3, 4]]],
  ['XLOOKUP', ['b', row('a', 'b'), arr([[1, 2], [3, 4]])], [[2], [4]]],
  ['XLOOKUP', [1, col(1, 2), col(1, 2, 3)], Errors.VALUE],
  ['XLOOKUP', [1, col(Errors.NA, 1), col('x', 'y')], 'y'],
  ['XLOOKUP', [Errors.NA, col(1), col(1)], Errors.NA],
  ['XLOOKUP', [1, col(1), col(1), undefined, 3], Errors.VALUE],
  ['XLOOKUP', [col(1, 3), col(1, 2, 3), col('a', 'b', 'c')], [['a'], ['c']]],
  ['XLOOKUP', [104, ref('A1:A6'), ref('B1:C6')], [['Patten', 'Michael']]],
  ['XMATCH', [4, col(1, 3, 5), 1], 3],
  ['XMATCH', [4, col(1, 3, 5), -1], 2],
  ['XMATCH', ['Gra?e', col('Apple', 'Grape', 'Pear'), 2], 2],
  ['XMATCH', [5, col(5, 1, 5), 0, -1], 3],
  ['XMATCH', [5, col(1, 3, 5, 7), 0, 2], 3],
  ['XMATCH', [9, col(1, 3)], Errors.NA],
  ['XMATCH', [1, arr([[1, 2], [3, 4]])], Errors.VALUE],
], data)

table('ADDRESS / HYPERLINK', [
  ['ADDRESS', [2, 3], '$C$2'],
  ['ADDRESS', [2, 3, 2], 'C$2'],
  ['ADDRESS', [2, 3, 3], '$C2'],
  ['ADDRESS', [1, 1, 4], 'A1'],
  ['ADDRESS', [2, 3, 2, false], 'R2C[3]'],
  ['ADDRESS', [2, 3, 1, false], 'R2C3'],
  ['ADDRESS', [2, 3, 1, false, '[Book1]Sheet1'], "'[Book1]Sheet1'!R2C3"],
  ['ADDRESS', [2, 3, 1, false, 'EXCEL SHEET'], "'EXCEL SHEET'!R2C3"],
  ['ADDRESS', [1, 1, 1, true, 'Sheet1'], 'Sheet1!$A$1'],
  ['ADDRESS', [1, 28], '$AB$1'],
  ['ADDRESS', [0, 1], Errors.VALUE],
  ['ADDRESS', [1, 16385], Errors.VALUE],
  ['ADDRESS', [1, 1, 5], Errors.VALUE],
  ['HYPERLINK', ['http://example.com', 'Click'], 'Click'],
  ['HYPERLINK', ['http://example.com'], 'http://example.com'],
  ['HYPERLINK', ['http://example.com', 42], 42],
])
