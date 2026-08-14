import { describe, expect, it } from 'vitest'
import {
  attachmentKind,
  attachmentTypeLabel,
  collectUploadFiles,
  isSupportedImageFile,
  nonImageAttachmentRestriction,
} from './attachments'

describe('attachment presentation', () => {
  it.each([
    ['photo.png', 'image/png', 'image'],
    ['brief.pdf', 'application/octet-stream', 'pdf'],
    ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text'],
    ['app.tsx', 'application/octet-stream', 'code'],
    ['budget.xlsx', 'application/octet-stream', 'spreadsheet'],
    ['pitch.pptx', 'application/octet-stream', 'presentation'],
    ['sources.tar.gz', 'application/gzip', 'archive'],
    ['interview.m4a', 'application/octet-stream', 'audio'],
    ['demo.mov', 'application/octet-stream', 'video'],
    ['README', 'application/octet-stream', 'file'],
  ] as const)('classifies %s as %s', (name, mimeType, expected) => {
    expect(attachmentKind(name, mimeType)).toBe(expected)
  })

  it('uses a concise extension label and falls back to the detected kind', () => {
    expect(attachmentTypeLabel('Quarterly Results.XLSX', 'application/octet-stream')).toBe('XLSX')
    expect(attachmentTypeLabel('README', 'text/plain')).toBe('TEXT')
    expect(attachmentTypeLabel('binary', 'application/octet-stream')).toBe('FILE')
  })
})

describe('collectUploadFiles', () => {
  it('keeps arbitrary and extensionless files', () => {
    const files = [
      new File(['archive'], 'bundle.zip', { type: 'application/zip' }),
      new File(['binary'], 'README', { type: '' }),
    ]

    expect(collectUploadFiles(files).map((file) => file.name)).toEqual(['bundle.zip', 'README'])
  })

  it('normalizes known image extensions with missing MIME metadata', () => {
    const [file] = collectUploadFiles([new File(['pixels'], 'photo.JPEG', { type: '' })])

    expect(file?.name).toBe('photo.JPEG')
    expect(file?.type).toBe('image/jpeg')
    expect(file && isSupportedImageFile(file)).toBe(true)
  })
})

describe('nonImageAttachmentRestriction', () => {
  const availableAgent = { agentAvailable: true, agentCapable: true }

  it('does not restrict image-only messages', () => {
    expect(nonImageAttachmentRestriction({
      hasNonImage: false,
      agentModeEnabled: false,
      ...availableAgent,
    })).toBeNull()
  })

  it('requires enabled, available, model-capable Agent mode for non-images', () => {
    expect(nonImageAttachmentRestriction({
      hasNonImage: true,
      agentModeEnabled: false,
      ...availableAgent,
    })).toBe('enable_agent')
    expect(nonImageAttachmentRestriction({
      hasNonImage: true,
      agentModeEnabled: true,
      agentAvailable: true,
      agentCapable: false,
    })).toBe('model_not_capable')
    expect(nonImageAttachmentRestriction({
      hasNonImage: true,
      agentModeEnabled: true,
      agentAvailable: false,
      agentCapable: true,
    })).toBe('agent_unavailable')
    expect(nonImageAttachmentRestriction({
      hasNonImage: true,
      agentModeEnabled: true,
      ...availableAgent,
    })).toBeNull()
  })
})
