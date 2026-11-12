import { ui, uit } from '@/i18n/ui'
import type { CompiledScene, DeviceFrame } from './timeline'

/**
 * What a screen shows of a scene's response so far: the agent's steps, how long it worked, and its file.
 * As in the apps, the response is `pending` (loading dots) until its first step or text arrives, and its
 * steps read as thinking until it does more than reason.
 */
export function responseParts(compiled: CompiledScene, device: DeviceFrame) {
  const { response } = compiled.scene
  const steps = (response.steps ?? []).slice(0, device.steps)
  const thinking = device.working && steps.every((step) => step.kind === 'reasoning')
  return {
    steps,
    traced: steps.length > 0,
    pending: device.chat && !device.answer && steps.length === 0,
    thinking,
    workLabel: thinking ? ui("Thinking…") : device.working ? ui("Working…") : uit`Worked for ${response.worked ?? ''}`,
    attachment: device.attachment ? response.attachment ?? null : null,
  }
}

/**
 * Whether a chat scrolls to its newest line as it grows. A scene that keeps the top in view still follows
 * the agent's steps while it works, and returns to the top once the answer starts.
 */
export function followsNewest(compiled: CompiledScene, device: DeviceFrame): boolean {
  return compiled.scene.scroll !== 'top' || device.working
}
