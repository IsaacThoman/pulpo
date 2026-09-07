import { NativeModule, requireOptionalNativeModule } from 'expo'

export interface ImportedFile {
  uri: string
  name: string
  mimeType: string
  size: number
}

declare class PulpoFileImportModule extends NativeModule {
  importFile(uri: string): Promise<ImportedFile>
}

export default requireOptionalNativeModule<PulpoFileImportModule>('PulpoFileImport')
