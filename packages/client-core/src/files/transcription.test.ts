import { describe, expect, it } from 'vitest'
import { canTranscribeAudio, MAX_AUDIO_TRANSCRIPTION_BYTES, transcriptionAudioFormat } from './transcription.js'

describe('audio transcription format', () => {
  it('keeps a stored type Groq accepts and hides the filename', () => {
    expect(transcriptionAudioFormat('Board meeting.mp3', 'audio/mpeg')).toEqual({ filename: 'audio.mp3', mimeType: 'audio/mpeg' })
    expect(transcriptionAudioFormat('memo', 'audio/webm;codecs=opus')).toEqual({ filename: 'audio.webm', mimeType: 'audio/webm' })
  })

  it('falls back to the extension for generic or unknown types', () => {
    expect(transcriptionAudioFormat('voice.m4a', 'application/octet-stream')).toEqual({ filename: 'audio.m4a', mimeType: 'audio/mp4' })
    expect(transcriptionAudioFormat('voice.WAV', null)).toEqual({ filename: 'audio.wav', mimeType: 'audio/wav' })
  })

  it('rejects formats Groq cannot read', () => {
    expect(transcriptionAudioFormat('voice.aac', 'audio/aac')).toBeNull()
    expect(transcriptionAudioFormat('notes.txt', 'text/plain')).toBeNull()
  })

  it('limits transcription to non-empty files within the upload limit', () => {
    expect(canTranscribeAudio('a.mp3', 'audio/mpeg', 1)).toBe(true)
    expect(canTranscribeAudio('a.mp3', 'audio/mpeg', 0)).toBe(false)
    expect(canTranscribeAudio('a.mp3', 'audio/mpeg', MAX_AUDIO_TRANSCRIPTION_BYTES + 1)).toBe(false)
  })
})
