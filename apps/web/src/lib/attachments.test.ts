import { describe, expect, it } from 'vitest'
import {
  collectUploadFiles,
  isSupportedImageFile,
  nonImageAttachmentRestriction,
} from './attachments'

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
