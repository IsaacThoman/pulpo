import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ConverterConfig {
  host: string
  port: number
  /** When set, requests must send `Authorization: Bearer <token>`. */
  token: string | null
  sofficePath: string
  workRoot: string
  maxInputBytes: number
  maxOutputBytes: number
  timeoutMs: number
  concurrency: number
  maxQueued: number
  memoryLimitMb?: number
}

function positiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = environment[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`)
  return value
}

export function parseConfig(environment: NodeJS.ProcessEnv): ConverterConfig {
  const token = environment.OFFICE_CONVERTER_TOKEN?.trim() || null
  if (token && token.length < 32) throw new Error('OFFICE_CONVERTER_TOKEN must be at least 32 characters')
  // Deployments on a shared network set this so a missing token stops the service instead of opening it.
  if (!token && environment.OFFICE_CONVERTER_REQUIRE_TOKEN?.trim() === 'true') throw new Error('OFFICE_CONVERTER_TOKEN is required')
  const memoryLimitMb = environment.OFFICE_CONVERTER_MEMORY_LIMIT_MB?.trim() ? positiveInteger(environment, 'OFFICE_CONVERTER_MEMORY_LIMIT_MB', 0) : undefined
  return {
    host: environment.HOST?.trim() || '0.0.0.0',
    port: positiveInteger(environment, 'PORT', 8790),
    token,
    sofficePath: environment.OFFICE_CONVERTER_SOFFICE?.trim() || 'soffice',
    workRoot: environment.OFFICE_CONVERTER_WORK_DIR?.trim() || join(tmpdir(), 'pulpo-office-converter'),
    maxInputBytes: positiveInteger(environment, 'OFFICE_CONVERTER_MAX_INPUT_MB', 100) * 1024 * 1024,
    maxOutputBytes: positiveInteger(environment, 'OFFICE_CONVERTER_MAX_OUTPUT_MB', 100) * 1024 * 1024,
    timeoutMs: positiveInteger(environment, 'OFFICE_CONVERTER_TIMEOUT_SECONDS', 60) * 1000,
    concurrency: positiveInteger(environment, 'OFFICE_CONVERTER_CONCURRENCY', 2),
    maxQueued: positiveInteger(environment, 'OFFICE_CONVERTER_MAX_QUEUED', 8),
    ...(memoryLimitMb ? { memoryLimitMb } : {}),
  }
}
