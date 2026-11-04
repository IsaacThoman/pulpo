import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EDITABLE_TARGET, INPUT_FORMATS, supportsConversion, type InputExtension } from './formats.js'

/**
 * Pulpo's clients decide what to offer from @pulpo/contracts (`officeConversionTarget`,
 * `canExportOfficePdf`); every conversion they offer must be one this service performs. The
 * built contracts are loaded at run time, so the image's own test stage, which has no
 * contracts package, skips this.
 */
const contractsUrl = new URL('../../contracts/dist/files.js', import.meta.url)
const contracts = existsSync(contractsUrl) ? await import(contractsUrl.href) as {
  officeConversionTarget: (name: string) => string | null
  canExportOfficePdf: (name: string) => boolean
} : null

describe.skipIf(!contracts)('agreement with @pulpo/contracts', () => {
  it('offers exactly the conversions the service performs', () => {
    for (const extension of Object.keys(INPUT_FORMATS) as InputExtension[]) {
      const target = EDITABLE_TARGET[INPUT_FORMATS[extension].family]
      const name = `file.${extension}`
      expect(contracts!.canExportOfficePdf(name), name).toBe(true)
      expect(contracts!.officeConversionTarget(name), name).toBe(extension === target ? null : target)
      if (extension !== target) expect(supportsConversion(extension, target)).toBe(true)
    }
    for (const name of ['file.pdf', 'file.md', 'file.csv', 'file.png']) {
      expect(contracts!.canExportOfficePdf(name)).toBe(false)
      expect(contracts!.officeConversionTarget(name)).toBeNull()
    }
  })
})
