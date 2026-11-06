import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { toIdForm } from '../model/formula-ids.js'
import { WorkbookModel } from '../model/workbook.js'
import { applyWorkbook } from './apply.js'

describe('sheet pairing with tombstones', () => {
  it('keeps an unchanged fallback tombstoned and revives it when a file adds another sheet', () => {
    const doc = new Y.Doc()
    const target = WorkbookModel.initialize(doc)
    const first = target.addSheet('First')
    const second = target.addSheet('Second')
    first.setCell(0, 0, { v: 10 })
    second.setCell(0, 0, { v: 20 })
    target.names.set('first', { name: 'LocalValue', scope: first.id, formula: toIdForm('A1', first) })
    target.names.set('second', { name: 'LocalValue', scope: second.id, formula: toIdForm('A1', second) })
    // This is the stored state after every sheet was deleted and hidden concurrently.
    for (const sheet of [first, second]) {
      sheet.map.set('deleted', true)
      sheet.map.set('state', 'hidden')
    }
    const incomingDoc = new Y.Doc()
    const incoming = WorkbookModel.initialize(incomingDoc)
    const incomingFirst = incoming.addSheet('First')
    incomingFirst.setCell(0, 0, { v: 10 })
    incoming.names.set('local', { name: 'LocalValue', scope: incomingFirst.id, formula: toIdForm('A1', incomingFirst) })
    expect(applyWorkbook(doc, incomingDoc).changed).toBe(false)
    expect(first.map.get('deleted')).toBe(true)
    expect(first.map.get('state')).toBe('hidden')
    expect([...target.names.keys()]).toEqual(['first'])

    incoming.addSheet('Third').setCell(0, 0, { v: 30 })
    expect(applyWorkbook(doc, incomingDoc).changed).toBe(true)
    expect(target.sheetIds()[0]).toBe(first.id)
    expect(target.sheets().map((sheet) => [sheet.name, sheet.state, sheet.cell(0, 0)?.v])).toEqual([['First', 'visible', 10], ['Third', 'visible', 30]])
    expect(second.map.get('deleted')).toBe(true)
    expect(second.cell(0, 0)?.v).toBe(20)
    expect(target.sheet(second.id)).toBeUndefined()
    expect(target.names.get('second')).toBeUndefined()
    expect(applyWorkbook(doc, incomingDoc).changed).toBe(false)
  })

  it('retains removed sheets and ignores their stored names when pairing later files', () => {
    const doc = new Y.Doc()
    const target = WorkbookModel.initialize(doc)
    const first = target.addSheet('First')
    const removed = target.addSheet('Removed')
    removed.setCell(0, 0, { v: 'retained' })
    const incomingDoc = new Y.Doc()
    const incoming = WorkbookModel.initialize(incomingDoc)
    incoming.addSheet('First')
    expect(applyWorkbook(doc, incomingDoc).changed).toBe(true)
    expect(target.order.toArray()).toEqual([first.id, removed.id])
    expect(target.sheet(removed.id)).toBeUndefined()
    expect(removed.map.get('deleted')).toBe(true)
    expect(removed.cell(0, 0)?.v).toBe('retained')
    incoming.addSheet('Removed').setCell(0, 0, { v: 'replacement' })
    applyWorkbook(doc, incomingDoc)
    expect(target.sheetByName('Removed')?.id).not.toBe(removed.id)
    expect(target.sheetByName('Removed')?.cell(0, 0)?.v).toBe('replacement')
    expect(removed.map.get('deleted')).toBe(true)
  })
})

describe('defined name identity', () => {
  it('updates case-insensitive names in place using paired sheet scopes through a rename', () => {
    const doc = new Y.Doc()
    const target = WorkbookModel.initialize(doc)
    const sheet = target.addSheet('Before')
    target.names.set('global', { name: 'Rate', formula: '1' })
    target.names.set('local', { name: 'Rate', scope: sheet.id, formula: toIdForm('A1', sheet) })
    const incomingDoc = new Y.Doc()
    const incoming = WorkbookModel.initialize(incomingDoc)
    const renamed = incoming.addSheet('After')
    incoming.names.set('a', { name: 'RATE', formula: '2' })
    incoming.names.set('b', { name: 'rate', scope: renamed.id, formula: toIdForm('B2', renamed) })
    expect(applyWorkbook(doc, incomingDoc).changed).toBe(true)
    expect([...target.names.keys()]).toEqual(['global', 'local'])
    expect(target.names.get('global')).toEqual({ name: 'RATE', formula: '2' })
    expect(target.names.get('local')).toEqual({ name: 'rate', scope: sheet.id, formula: toIdForm('B2', sheet) })
    expect(applyWorkbook(doc, incomingDoc).changed).toBe(false)
    incoming.names.delete('a')
    incoming.names.delete('b')
    applyWorkbook(doc, incomingDoc)
    expect([...target.names.values()]).toEqual([])
    doc.destroy()
    incomingDoc.destroy()
  })
})
