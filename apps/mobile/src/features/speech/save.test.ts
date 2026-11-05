import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  audioFile: vi.fn(), exportFile: vi.fn(), enqueueUploads: vi.fn(async () => {}), share: vi.fn(async () => {}),
}))
vi.mock('./state', () => ({ speechPlayback: { audioFile: mocks.audioFile } }))
vi.mock('../files/api', () => ({ exportFile: mocks.exportFile }))
vi.mock('../files/uploads', () => ({ enqueueUploads: mocks.enqueueUploads }))
vi.mock('../../native/shareFile', () => ({ shareLocalFile: mocks.share }))
import { saveSpeechToFiles, shareSpeechAudio } from './save'

const bytes = new Uint8Array([1, 2, 3])
beforeEach(() => {
  vi.clearAllMocks()
  mocks.audioFile.mockResolvedValue({ bytes, format: 'mp3', mimeType: 'audio/mpeg', name: 'Hello there.mp3' })
  mocks.exportFile.mockReturnValue({ uri: 'file:///cache/files-export/Hello there.mp3', name: 'Hello there.mp3', size: 3 })
})

it('shares the joined speech as an audio file', async () => {
  await shareSpeechAudio()
  expect(mocks.exportFile).toHaveBeenCalledWith('Hello there.mp3', bytes)
  expect(mocks.share).toHaveBeenCalledWith('file:///cache/files-export/Hello there.mp3', 'Hello there.mp3', 'audio/mpeg')
})

it('queues the joined speech for upload into My files', async () => {
  const client = {} as never
  await saveSpeechToFiles('namespace', client)
  expect(mocks.enqueueUploads).toHaveBeenCalledWith('namespace', null, [{ uri: 'file:///cache/files-export/Hello there.mp3', name: 'Hello there.mp3', mimeType: 'audio/mpeg', sizeBytes: 3 }], client)
})

it('does not share or upload when the audio cannot be prepared', async () => {
  mocks.audioFile.mockRejectedValue(new Error('Reading stopped before the audio could be saved'))
  await expect(shareSpeechAudio()).rejects.toThrow('Reading stopped')
  await expect(saveSpeechToFiles('namespace', {} as never)).rejects.toThrow('Reading stopped')
  expect(mocks.exportFile).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled(); expect(mocks.enqueueUploads).not.toHaveBeenCalled()
})
