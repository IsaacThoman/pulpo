/** Deterministic PCM fixtures generated in memory; no recorded voice data. */
export function speechTestWav(seconds = 1, frequency = 440, amplitude = 0.2) {
  const samples = Math.round(24000 * seconds); const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * frequency * i / 24000)), 44 + i * 2)
  return bytes
}
export function speechTestSamples(wav: Buffer): number[] {
  let offset = 12
  while (offset + 8 <= wav.length) {
    const size = wav.readUInt32LE(offset + 4)
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      const end = Math.min(wav.length, offset + 8 + size)
      const samples: number[] = []
      for (let i = offset + 8; i + 1 < end; i += 2) samples.push(wav.readInt16LE(i) / 32768)
      return samples
    }
    offset += 8 + size + size % 2
  }
  throw new Error('Missing PCM data')
}
