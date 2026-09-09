import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mixSpeechWatermark, normalizeSpeechAsset } from './audio.js'
import { speechAudioDuration } from './provider.js'
import { speechTestSamples, speechTestWav } from './audio-fixtures.js'
const signal = () => new AbortController().signal
const rms = (samples: number[]) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
describe('real speech audio processing', () => {
  it('decodes and validates reference duration rather than trusting metadata or filenames', async () => {
    const reference = await normalizeSpeechAsset(speechTestWav(3), 'clone', signal())
    expect(reference.durationSeconds).toBeCloseTo(3, 2)
    await expect(normalizeSpeechAsset(speechTestWav(2), 'clone', signal())).rejects.toMatchObject({ code: 'speech_asset_invalid' })
    await expect(normalizeSpeechAsset(speechTestWav(31), 'watermark', signal())).rejects.toMatchObject({ code: 'speech_asset_invalid' })
    await expect(normalizeSpeechAsset(Buffer.from('#EXTM3U\nfile:///etc/passwd'), 'clone', signal())).rejects.toMatchObject({ code: 'speech_asset_invalid' })
  })
  it('decodes every advertised upload format', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'speech-formats-'))
    try {
      const source = join(directory, 'source.wav'); await writeFile(source, speechTestWav(3))
      for (const [format, encoder] of [['mp3', 'libmp3lame'], ['m4a', 'aac'], ['aac', 'aac'], ['flac', 'flac'], ['ogg', 'vorbis'], ['opus', 'libopus']]) {
        const output = execFileSync('ffmpeg', ['-v', 'error', '-i', source, '-c:a', encoder!, ...(format === 'ogg' ? ['-strict', '-2', '-ac', '2'] : []), '-f', format === 'm4a' ? 'ipod' : format === 'aac' ? 'adts' : format!, ...(format === 'm4a' ? ['-movflags', 'frag_keyframe+empty_moov'] : []), 'pipe:1'])
        const asset = await normalizeSpeechAsset(output, 'clone', signal())
        expect(asset.durationSeconds, format).toBeGreaterThanOrEqual(3)
        expect(asset.durationSeconds, format).toBeLessThan(3.2)
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('loops at the requested phase, adjusts volume and ends with speech', async () => {
    const speech = speechTestWav(2, 440, 0)
    const watermark = speechTestWav(0.37, 173, 0.4)
    const options = { format: 'wav' as const, volume: 0.15, offsetSeconds: 0, signal: signal() }
    const first = await mixSpeechWatermark(speech, watermark, options)
    const louder = await mixSpeechWatermark(speech, watermark, { ...options, volume: 0.3 })
    expect(await speechAudioDuration(first, 'wav')).toBeCloseTo(2, 2)
    expect(rms(speechTestSamples(first))).toBeGreaterThan(0.03)
    expect(rms(speechTestSamples(louder)) / rms(speechTestSamples(first))).toBeCloseTo(2, 1)
    const entire = speechTestSamples(await mixSpeechWatermark(speechTestWav(4, 440, 0), watermark, options))
    const next = speechTestSamples(await mixSpeechWatermark(speech, watermark, { ...options, offsetSeconds: 2 }))
    const difference = next.slice(100, -100).map((sample, i) => sample - entire[48000 + i + 100]!)
    expect(rms(difference)).toBeLessThan(0.001)
  })
  it('encodes playable MP3 mixes with only normal codec padding', async () => {
    const speech = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1'], { input: speechTestWav(2) })
    const mixed = await mixSpeechWatermark(speech, speechTestWav(0.2, 660), { format: 'mp3', volume: 0.15, offsetSeconds: 7.3, signal: signal() })
    const duration = await speechAudioDuration(mixed, 'mp3')
    expect(duration).toBeGreaterThanOrEqual(2); expect(duration).toBeLessThan(2.15)
  })
  it('cancels active and queued audio work and releases processing capacity', async () => {
    const before = (await readdir(tmpdir())).filter(name => name.startsWith('pulpo-speech-'))
    const controller = new AbortController()
    const jobs = Array.from({ length: 5 }, () => normalizeSpeechAsset(speechTestWav(30), 'clone', controller.signal))
    const outcome = Promise.allSettled(jobs)
    setTimeout(() => controller.abort(), 5)
    expect((await outcome).every(result => result.status === 'rejected')).toBe(true)
    expect((await normalizeSpeechAsset(speechTestWav(3), 'clone', signal())).durationSeconds).toBeCloseTo(3)
    expect((await readdir(tmpdir())).filter(name => name.startsWith('pulpo-speech-'))).toEqual(before)
  })
  it('limits peaks and cleans up processes and temporary files on failures', async () => {
    const before = (await readdir(tmpdir())).filter(name => name.startsWith('pulpo-speech-'))
    const mixed = await mixSpeechWatermark(speechTestWav(1, 440, 0.9), speechTestWav(1, 440, 0.9), { format: 'wav', volume: 1, offsetSeconds: 0, signal: signal() })
    expect(Math.max(...speechTestSamples(mixed).map(Math.abs))).toBeLessThanOrEqual(0.951)
    await expect(mixSpeechWatermark(speechTestWav(), Buffer.from('broken'), { format: 'wav', volume: 0.15, offsetSeconds: 0, signal: signal() })).rejects.toMatchObject({ code: 'speech_watermark_failed' })
    const controller = new AbortController(); controller.abort()
    await expect(normalizeSpeechAsset(speechTestWav(3), 'clone', controller.signal)).rejects.toThrow()
    expect((await readdir(tmpdir())).filter(name => name.startsWith('pulpo-speech-'))).toEqual(before)
  })
})
