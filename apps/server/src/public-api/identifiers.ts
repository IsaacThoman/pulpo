import { AppError } from '../lib/errors.js'

/** Identifiers go into PostgreSQL text/UUID fields, unlike lossless conversation content. */
export function assertPublicIdentifier(value: string, param: string): void {
  if (value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value) {
    throw new AppError(400, 'validation_error', 'Identifier contains unsupported Unicode characters', 'invalid_request_error', param)
  }
}
