import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { nativeAuthorizationHeaders } from '../../../api/client';
import { useSessionStore } from '../../../store/session';
import { useAppTheme } from '../theme';

export function ProfileAvatar({ size }: { size: number }) {
  const theme = useAppTheme();
  const user = useSessionStore((state) => state.user);
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const uri = user?.avatarUrl ? new URL(user.avatarUrl, `${instanceUrl}/`).toString() : null;
  return <AvatarImage key={`${user?.id}:${uri}`} size={size} uri={uri} name={user?.name ?? 'Pulpo user'} isDark={theme.isDark} />;
}

function AvatarImage({ size, uri, name, isDark }: { size: number; uri: string | null; name: string; isDark: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
  return <View pointerEvents="none" accessible accessibilityLabel={`${name}'s profile picture`} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: isDark ? '#d4d4d8' : '#3f3f46' }]}>
    <Text style={{ color: isDark ? '#18181b' : '#f4f4f5', fontSize: size / 3, fontWeight: '600' }}>{initials}</Text>
    {uri && !failed ? <Image source={{ uri, headers: nativeAuthorizationHeaders(uri) }} resizeMode="cover" style={StyleSheet.absoluteFill} onError={() => setFailed(true)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
