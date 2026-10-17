import { NativeModule, requireOptionalNativeModule } from 'expo'

export type FinalStateEvent = { instanceId: string; state: string | null }

declare class PulpoDocEditorModule extends NativeModule<{ onFinalState: (event: FinalStateEvent) => void }> {}

/** Null in binaries built before the document editor, and on platforms without its host. */
export default requireOptionalNativeModule<PulpoDocEditorModule>('PulpoDocEditor')
