import type { FastifyRequest } from 'fastify'
import { getBlobStore } from '../storage/index.js'

// Retained for cleanup of legacy saved previews when a voice or model is deleted.
export async function cleanupSpeechPreview(key: string | null | undefined, request: FastifyRequest) {
  if (key) await getBlobStore().delete(key).catch(() => request.log.warn('Speech preview cleanup failed'))
}
