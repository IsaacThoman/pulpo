import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'
import { DEFAULT_AVATAR_CROP, PROFILE_AVATAR_MAX_BYTES } from '@pulpo/contracts'

export type AvatarSource = 'library' | 'camera'

/** A cropped photo ready to upload as the profile picture. */
export interface AvatarCandidate {
  uri: string
  name: string
  mimeType: string
  size?: number
}

/** Camera access was refused; `canAskAgain` is false once only Settings can grant it. */
export class AvatarCameraPermissionError extends Error {
  constructor(readonly canAskAgain: boolean) {
    super('Allow Pulpo to use the camera to take a profile picture.')
    this.name = 'AvatarCameraPermissionError'
  }
}

const AVATAR_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

/**
 * The system crop UI (square on iOS, a square oval guide on Android) does the cropping.
 * Re-encoding below full quality keeps camera photos under the server's 5 MiB limit, and
 * the compatible representation turns HEIC library photos into JPEG, which the server accepts.
 */
export const AVATAR_PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  shape: 'oval',
  quality: 0.85,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
}

function avatarMimeType(asset: Pick<ImagePicker.ImagePickerAsset, 'mimeType' | 'uri' | 'fileName'>): string {
  const declared = asset.mimeType?.toLowerCase()
  if (declared && Object.values(AVATAR_TYPES).includes(declared)) return declared
  const extension = (asset.fileName ?? asset.uri).split(/[?#]/, 1)[0]!.split('.').pop()?.toLowerCase()
  return (extension && AVATAR_TYPES[extension]) ?? 'image/jpeg'
}

export function avatarCandidate(asset: Pick<ImagePicker.ImagePickerAsset, 'mimeType' | 'uri' | 'fileName' | 'fileSize'>): AvatarCandidate {
  const mimeType = avatarMimeType(asset)
  const extension = Object.entries(AVATAR_TYPES).find(([, type]) => type === mimeType)?.[0] ?? 'jpg'
  return { uri: asset.uri, name: `avatar.${extension}`, mimeType, size: asset.fileSize }
}

/** Same copy as the server's 413, without sending a file it would refuse. */
export function avatarSizeError(candidate: AvatarCandidate): string | null {
  return candidate.size !== undefined && candidate.size > PROFILE_AVATAR_MAX_BYTES ? 'Profile pictures may be at most 5 MiB' : null
}

/** Opens Photos or the camera with the system crop UI; resolves null when cancelled. */
export async function pickAvatar(source: AvatarSource): Promise<AvatarCandidate | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) throw new AvatarCameraPermissionError(permission.canAskAgain)
  }
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(AVATAR_PICKER_OPTIONS)
    : await ImagePicker.launchImageLibraryAsync(AVATAR_PICKER_OPTIONS)
  const asset = result.canceled ? null : result.assets[0]
  return asset ? avatarCandidate(asset) : null
}

/**
 * The upload body for `PUT /api/me/avatar`. The photo is already cropped to a square, so the
 * web editor's default settings make the server produce the same 512px circle web uploads get.
 * The crop field must come before the file for the server to read it.
 */
export function avatarUploadBody(candidate: AvatarCandidate): FormData {
  const body = new FormData()
  body.append('crop', JSON.stringify(DEFAULT_AVATAR_CROP))
  // SDK 57 uses standards-based fetch; URI descriptors are not multipart Blobs.
  const file = new File(candidate.uri)
  Object.defineProperties(file, { type: { value: candidate.mimeType }, name: { value: candidate.name } })
  body.append('file', file, candidate.name)
  return body
}
