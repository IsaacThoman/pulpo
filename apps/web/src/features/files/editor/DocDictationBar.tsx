import { X } from 'lucide-react'
import { DictationBar } from '@/components/chat/DictationBar'
import { ui } from '@/i18n/ui'
import type { DocDictation } from './doc-dictation'

/**
 * Floats at the bottom of the document while dictating, like the dictation toolbar in Word: cancel,
 * the live waveform and timer, and finish. Problems show in its place afterwards.
 */
export function DocDictationBar({ dictation }: { dictation: DocDictation }) {
  const { recorder } = dictation
  const active = recorder.phase !== 'idle'
  return (
    // No height of its own, so it adds no space under the document.
    <div className="pointer-events-none sticky bottom-0 z-20 h-0">
      <div className="absolute inset-x-0 bottom-4 grid justify-items-center px-4">
        {recorder.error && !active && (
          <div role="alert" className="pointer-events-auto col-start-1 row-start-1 flex max-w-md items-center gap-2 rounded-full border bg-background py-1 pl-4 pr-1 text-xs text-destructive shadow-lg">
            <span className="min-w-0 flex-1">{recorder.error}</span>
            <button
              type="button"
              onClick={() => recorder.setError(null)}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={ui("Dismiss")}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div
          className="pulpo-doc-dictation col-start-1 row-start-1 w-full max-w-md rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur"
          data-active={active}
          inert={!active}
          // The caret stays in the document, where the transcript goes.
          onMouseDown={(event) => event.preventDefault()}
        >
          <DictationBar
            phase={recorder.phase}
            stream={recorder.stream}
            startedAt={recorder.startedAt}
            onCancel={dictation.cancel}
            onConfirm={recorder.stop}
          />
        </div>
      </div>
    </div>
  )
}
