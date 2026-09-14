/** Synthetic fixture; contains no captured production prompts or user information. */
export const windowsToolOutput = 'PartitionNumber DriveLetter Size Type\r\n1 C 128 IFS\r\n2 \u0000 0 Unknown\r\n'
export const unusualText = `${windowsToolOutput}Literal: \\u0000; emoji: 🐙; unmatched: \ud800 / \udfff; end`
export const unusualPayload = {
  ['key\u0000\ud800']: ['literal \\u0000', unusualText, '', null],
  nested: { output: unusualText },
}
