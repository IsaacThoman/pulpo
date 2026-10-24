import type { File, UploadOptions, UploadResult } from 'expo-file-system'
import { ApiError } from '../../api/client'

/**
 * How long an upload may go without sending bytes or receiving its response before it fails.
 * Shorter than iOS's 60-second request idle timeout, so a stall reports as this timeout.
 */
export const UPLOAD_STALL_TIMEOUT_MS = 45_000

/**
 * PUTs a file on a foreground session, failing once it makes no progress for `stallMs`.
 *
 * Expo defaults iOS uploads to a background session, which lets the system defer a transfer
 * indefinitely; the attachment then showed as uploading forever and held an upload slot. The
 * stall timer settles the promise itself, so a native task that ignores cancellation cannot
 * keep the caller waiting either.
 */
export async function uploadFileWithStallTimeout(
  file: Pick<File, 'upload'>,
  url: string,
  options: Pick<UploadOptions, 'httpMethod' | 'mimeType' | 'headers'>,
  stallMs = UPLOAD_STALL_TIMEOUT_MS,
): Promise<UploadResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectStall: (error: Error) => void = () => {}
  const stall = new Promise<never>((_resolve, reject) => { rejectStall = reject })
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      rejectStall(new ApiError(408, 'request_timeout', 'The upload stopped making progress.'))
      controller.abort()
    }, stallMs)
  }
  arm()
  try {
    return await Promise.race([
      file.upload(url, { ...options, sessionType: 'foreground', signal: controller.signal, onProgress: arm }),
      stall,
    ])
  } finally {
    clearTimeout(timer)
  }
}
