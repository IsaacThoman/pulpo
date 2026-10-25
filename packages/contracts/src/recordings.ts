import { z } from 'zod'
import { fileNameSchema, type FileNode } from './files.js'

/**
 * A voice recording is a Files item (`kind: 'recording'`) made of takes: separately recorded
 * pieces of audio that play one after another. Recording again appends a take. Each take keeps
 * its own transcript, with timestamps from the take's start, and the parts of it that playback
 * jumps over.
 */

/** Largest take a client may upload: what the transcription provider accepts in one request. */
export const RECORDING_CLIP_MAX_BYTES = 25 * 1024 * 1024
/**
 * Longest take. Recorders finish a take and carry on in a new one at this length, so a long
 * recording becomes several takes that each fit one transcription request.
 */
export const RECORDING_TAKE_MAX_SECONDS = 30 * 60
/** Most takes one recording can hold. */
export const RECORDING_MAX_CLIPS = 200
/** Most skipped parts one recording can hold. */
export const RECORDING_MAX_SKIPS = 1_000
/** Waveform levels stored per second of audio, each 0–100. */
export const RECORDING_LEVELS_PER_SECOND = 10
/** Bit rate recorders ask for: clear speech, with a full-length take well under the size limit. */
export const RECORDING_AUDIO_BITS_PER_SECOND = 64_000

export const recordingTranscriptStatusSchema = z.enum(['pending', 'ready', 'failed', 'unavailable'])
/**
 * `pending`: queued or being transcribed. `failed`: the provider could not transcribe it (`error`
 * says why); it can be tried again. `unavailable`: transcription is turned off on this server.
 */
export type RecordingTranscriptStatus = z.infer<typeof recordingTranscriptStatusSchema>

/** A part of a take, in milliseconds from the take's start. */
export interface RecordingRange {
  startMs: number
  endMs: number
}

export interface RecordingTranscriptSegment extends RecordingRange {
  text: string
}

export interface RecordingClip {
  id: string
  /** Takes play by ascending position. */
  position: number
  mimeType: string
  sizeBytes: number
  durationMs: number
  /** Loudness, RECORDING_LEVELS_PER_SECOND times a second, 0–100, for the waveform. */
  levels: number[]
  /** Parts playback jumps over, sorted and not overlapping. */
  skips: RecordingRange[]
  transcript: {
    status: RecordingTranscriptStatus
    segments: RecordingTranscriptSegment[]
    error: string | null
  }
  /** When the take was recorded. */
  recordedAt: string
  createdAt: string
}

export interface FileRecording {
  node: FileNode
  clips: RecordingClip[]
}

export const createRecordingSchema = z.object({
  parentId: z.uuid().nullable().default(null),
  name: fileNameSchema.optional(),
})

const MAX_TAKE_MS = (RECORDING_TAKE_MAX_SECONDS + 60) * 1000

/** Sent with a take's audio as the multipart field `metadata` (JSON), before the file. */
export const recordingClipMetadataSchema = z.object({
  durationMs: z.number().int().min(1).max(MAX_TAKE_MS),
  levels: z.array(z.number().int().min(0).max(100)).max(Math.ceil(MAX_TAKE_MS / 1000) * RECORDING_LEVELS_PER_SECOND).default([]),
  recordedAt: z.iso.datetime({ offset: true }).optional(),
})

const recordingSkipSchema = z.object({
  clipId: z.uuid(),
  startMs: z.number().int().min(0).max(MAX_TAKE_MS),
  endMs: z.number().int().min(1).max(MAX_TAKE_MS),
}).refine((skip) => skip.endMs > skip.startMs, { message: 'A skipped part must end after it starts' })

/** Replaces every skipped part of the recording. */
export const updateRecordingSkipsSchema = z.object({
  skips: z.array(recordingSkipSchema).max(RECORDING_MAX_SKIPS),
})

export type CreateRecording = z.input<typeof createRecordingSchema>
export type RecordingClipMetadata = z.input<typeof recordingClipMetadataSchema>
export type RecordingSkipUpdate = z.infer<typeof recordingSkipSchema>
export type UpdateRecordingSkips = z.input<typeof updateRecordingSkipsSchema>
