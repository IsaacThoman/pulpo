import { describe, expect, it } from 'vitest'
import { openFilesLinkInApp, parseFilesLink, useFilesLinkInbox } from './links'

const instance = 'https://pulpo.example'
const id = '0B0C9C2E-6D2A-4C0B-9E8B-1F2D3C4B5A69'

describe('Files links', () => {
  it('opens My files, folders, documents, and the trash', () => {
    expect(parseFilesLink('pulpo://files', instance)).toEqual({ type: 'folder', id: null })
    expect(parseFilesLink(`pulpo://files/f/${id}`, instance)).toEqual({ type: 'folder', id: id.toLowerCase() })
    expect(parseFilesLink(`pulpo://files/d/${id}`, instance)).toEqual({ type: 'file', id: id.toLowerCase() })
    expect(parseFilesLink('pulpo://files/trash', instance)).toEqual({ type: 'trash' })
    expect(parseFilesLink(`${instance}/files/d/${id}`, instance)).toEqual({ type: 'file', id: id.toLowerCase() })
  })

  it('ignores other hosts, instances, and malformed ids', () => {
    expect(parseFilesLink(`https://elsewhere.example/files/d/${id}`, instance)).toBeNull()
    expect(parseFilesLink('pulpo://files/d/not-an-id', instance)).toBeNull()
    expect(parseFilesLink(`pulpo://shortcuts/d/${id}`, instance)).toBeNull()
    expect(parseFilesLink(`pulpo://user:pass@files/d/${id}`, instance)).toBeNull()
    expect(parseFilesLink('javascript:alert(1)', instance)).toBeNull()
  })

  it('keeps only the latest pending Files link until taken', () => {
    useFilesLinkInbox.getState().receive('pulpo://shortcuts?action=new-chat')
    expect(useFilesLinkInbox.getState().pending).toBeNull()
    useFilesLinkInbox.getState().receive('pulpo://files')
    useFilesLinkInbox.getState().receive(`pulpo://files/d/${id}`)
    expect(useFilesLinkInbox.getState().take()).toBe(`pulpo://files/d/${id}`)
    expect(useFilesLinkInbox.getState().take()).toBeNull()
  })

  it('opens Files links tapped in replies in the app, written in full or as a path', () => {
    useFilesLinkInbox.getState().take()
    expect(openFilesLinkInApp(`/files/d/${id}`, instance)).toBe(true)
    expect(useFilesLinkInbox.getState().take()).toBe(`${instance}/files/d/${id}`)
    expect(openFilesLinkInApp(`${instance}/files/f/${id}`, instance)).toBe(true)
    expect(useFilesLinkInbox.getState().take()).toBe(`${instance}/files/f/${id}`)
    expect(openFilesLinkInApp('https://example.com/files/d/x', instance)).toBe(false)
    expect(openFilesLinkInApp(`//elsewhere.example/files/d/${id}`, instance)).toBe(false)
    expect(openFilesLinkInApp('/settings', instance)).toBe(false)
    expect(useFilesLinkInbox.getState().take()).toBeNull()
  })
})
