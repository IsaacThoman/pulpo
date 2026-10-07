import { Image } from 'react-native'

export function Smiley({ size }: { size: number }) {
  return <Image source={require('../../assets/brand-mark.png')} style={{ width: size, height: size }} />
}
