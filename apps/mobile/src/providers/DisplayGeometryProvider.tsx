import { useState, type ReactNode } from 'react'
import { Platform, View } from 'react-native'
import { EMPTY_DISPLAY_GEOMETRY } from '../displayGeometry'
import { DisplayGeometryView } from '../native/DisplayGeometryView'
import { DisplayGeometryContext } from './displayGeometryContext'

/** Tracks the vertical bar and folds of foldable iPhones. Must sit under SafeAreaProvider. */
export function DisplayGeometryProvider({ children }: { children: ReactNode }) {
  const [geometry, setGeometry] = useState(EMPTY_DISPLAY_GEOMETRY)
  if (Platform.OS !== 'ios') return children
  return (
    <DisplayGeometryContext.Provider value={geometry}>
      <View style={{ flex: 1 }}>
        {children}
        <DisplayGeometryView onChange={setGeometry} />
      </View>
    </DisplayGeometryContext.Provider>
  )
}
