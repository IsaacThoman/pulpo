import { Alert, Platform } from 'react-native'
import { incomingFiles } from '../src/native/incomingFiles'
import { redirectFileIntent } from '../src/native/fileIntent'

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (Platform.OS !== 'ios') return path
  return redirectFileIntent(path, (uri) => {
    void incomingFiles.enqueue(uri).catch(() => {
      Alert.alert('Couldn’t import file', 'Pulpo could not save the incoming file. Please try opening it again.')
    })
  })
}
