export interface SpeechAssetBlob { objectKey: string; contentType: string; checksum: string; durationSeconds: number }
export interface SpeechVoiceAssets {
  voiceId: string
  clone?: SpeechAssetBlob & { upstreamVoiceId: string }
  watermark?: SpeechAssetBlob
}
