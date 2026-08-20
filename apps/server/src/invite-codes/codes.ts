import { randomInt } from 'node:crypto'

export const INVITE_CODE_LENGTH = 6
export const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const INVITE_CODE_PATTERN = /^[0-9A-Z]{6}$/

export function generateInviteCode(): string {
  let code = ''
  for (let index = 0; index < INVITE_CODE_LENGTH; index++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeInviteCode(value: string): string | null {
  const code = value.trim().toUpperCase()
  return INVITE_CODE_PATTERN.test(code) ? code : null
}
