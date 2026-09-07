import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Text, View, type ColorValue } from 'react-native'
import type { ToolImagePreview as Preview } from '@pulpo/contracts'
import { downloadAttachmentThumbnail } from '../features/chat/api'

export function ToolImagePreview({ preview, expanded, mutedColor }: {
  preview?: Preview
  expanded: boolean
  mutedColor: ColorValue
}) {
  return expanded && preview ? <Thumbnail key={preview.attachmentId} preview={preview} mutedColor={mutedColor} /> : null
}

function Thumbnail({ preview, mutedColor }: { preview: Preview; mutedColor: ColorValue }) {
  const [uri, setUri] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void downloadAttachmentThumbnail(preview.attachmentId).then((file) => {
      if (!cancelled) setUri(file.uri)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [preview.attachmentId])

  if (failed) return <Text accessibilityRole="text" style={{ color: mutedColor, fontSize: 12 }}>Image preview unavailable</Text>
  return (
    <View style={{ width: '100%', height: uri ? 192 : 96, overflow: 'hidden', borderRadius: 6, justifyContent: 'center' }}>
      {uri ? <Image
        accessibilityLabel={preview.name}
        source={{ uri }}
        resizeMode="contain"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: 192 }}
      /> : <ActivityIndicator accessibilityLabel="Loading image preview" color={mutedColor} />}
    </View>
  )
}
