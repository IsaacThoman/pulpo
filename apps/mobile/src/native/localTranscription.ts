import PulpoSpeechTranscriber from '../../modules/pulpo-speech-transcriber'

type NativeTranscriber = NonNullable<typeof PulpoSpeechTranscriber>

function deviceLanguage(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale
}

function errorText(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const message = error instanceof Error ? error.message : ''
  return `${code} ${message}`
}

function friendlyError(error: unknown, fallback: string): Error {
  if (/unsupported.?locale|does not support/i.test(errorText(error))) {
    return new Error('On-device transcription does not support this device language yet.')
  }
  return new Error(fallback)
}

function abortError(): Error {
  // Hermes has no DOMException; callers only check the name.
  const error = new Error('Transcription was cancelled.')
  error.name = 'AbortError'
  return error
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined)
    return Promise.reject(abortError())
  }
  return new Promise<T>((resolve, reject) => {
    // The native transcriber cannot be interrupted; a cancelled result is simply ignored.
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export interface LocalTranscriber {
  /** Starts resolving the language model so a first-use download overlaps with recording. */
  warmUp(): void
  transcribe(uri: string, signal: AbortSignal): Promise<string>
}

/** Apple's on-device speech transcriber (iOS 26), or null where the module or model is unavailable. */
export function createLocalTranscriber(
  native: NativeTranscriber | null = PulpoSpeechTranscriber,
  language: () => string = deviceLanguage,
): LocalTranscriber | null {
  if (!native) return null
  try {
    if (!native.isAvailable()) return null
  } catch {
    return null
  }
  let prepared: { language: string; locale: Promise<string> } | null = null
  const prepare = () => {
    const requested = language()
    if (prepared?.language !== requested) {
      const locale = native.prepare(requested).catch((error: unknown) => {
        // Let the next attempt retry, e.g. after a failed model download.
        if (prepared?.locale === locale) prepared = null
        throw friendlyError(error, 'On-device transcription could not prepare its language model.')
      })
      prepared = { language: requested, locale }
    }
    return prepared.locale
  }
  return {
    warmUp: () => { void prepare().catch(() => undefined) },
    transcribe: (uri, signal) => abortable((async () => {
      const locale = await prepare()
      try {
        return await native.transcribe(uri, locale)
      } catch (error) {
        throw friendlyError(error, 'On-device transcription failed. Please try again.')
      }
    })(), signal),
  }
}

let shared: LocalTranscriber | null | undefined
/** The app-wide on-device transcriber, created on first use. */
export function localTranscriber(): LocalTranscriber | null {
  if (shared === undefined) shared = createLocalTranscriber()
  return shared
}
