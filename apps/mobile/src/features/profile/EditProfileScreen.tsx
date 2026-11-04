import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Button as RNButton, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button as SwiftUIButton,
  Form as SwiftUIForm,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  LabeledContent as SwiftUILabeledContent,
  Menu as SwiftUIMenu,
  RNHostView as SwiftUIRNHostView,
  Section as SwiftUISection,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  TextField as SwiftUITextField,
  VStack as SwiftUIVStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import { accessibilityLabel, autocorrectionDisabled, disabled, font, foregroundStyle, frame, listRowBackground, multilineTextAlignment, scrollDismissesKeyboard, textFieldStyle, textInputAutocapitalization, tint } from '@expo/ui/swift-ui/modifiers';
import { normalizeUsername } from '@pulpo/client-core';
import { mobileApi } from '../../api/client';
import { useSessionStore } from '../../store/session';
import { showActions } from '../../platform/materialActions';
import { Card, Field, ListRow, PageHeader, PrimaryButton, Screen } from '../../mockup5/src/components/PrototypeUI';
import { ProfileAvatar } from '../../mockup5/src/components/ProfileAvatar';
import { usePrototypeStore } from '../../mockup5/src/store/prototypeStore';
import { useAppTheme } from '../../mockup5/src/theme';
import type { RootStackParamList } from '../../mockup5/src/navigation';
import { AvatarCameraPermissionError, avatarSizeError, avatarUploadBody, pickAvatar, type AvatarSource } from './avatar';
import { profileDraft, USERNAME_HINT } from './profileDraft';

const NAME_HINT = 'This is the name shown on your Pulpo account.';
const AVATAR_SIZE = 96;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : undefined;

/** Picks, uploads and removes the profile picture right away, like web's profile settings. */
function useAvatarActions() {
  const setUser = useSessionStore((state) => state.setUser);
  const [busy, setBusy] = useState(false);
  const choose = useCallback(async (source: AvatarSource) => {
    let candidate;
    try {
      candidate = await pickAvatar(source);
    } catch (error) {
      if (error instanceof AvatarCameraPermissionError) {
        Alert.alert('Camera access is required', error.message, error.canAskAgain
          ? [{ text: 'OK' }]
          : [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => void Linking.openSettings() }]);
      } else if (source === 'camera') Alert.alert('Camera unavailable', 'Pulpo could not open the camera on this device.');
      else Alert.alert('Couldn’t open Photos', 'Please try again.');
      return;
    }
    if (!candidate) return;
    const tooLarge = avatarSizeError(candidate);
    if (tooLarge) { Alert.alert('Couldn’t upload profile picture', tooLarge); return; }
    setBusy(true);
    try {
      const { user } = await mobileApi.uploadAvatar(avatarUploadBody(candidate));
      await setUser(user);
    } catch (error) {
      Alert.alert('Couldn’t upload profile picture', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [setUser]);
  const remove = useCallback(async () => {
    setBusy(true);
    try {
      const { user } = await mobileApi.removeAvatar();
      await setUser(user);
    } catch (error) {
      Alert.alert('Couldn’t remove profile picture', errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [setUser]);
  return { busy, choose, remove };
}

function EditableAvatar({ busy }: { busy: boolean }) {
  return <View style={styles.avatar}>
    <ProfileAvatar size={AVATAR_SIZE} />
    {busy ? <View style={styles.avatarBusy}><ActivityIndicator color="#ffffff" accessibilityLabel="Updating profile picture" /></View> : null}
  </View>;
}

function NativeNameRow({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const nativeText = useNativeState(value);
  useEffect(() => { if (nativeText.get() !== value) nativeText.set(value); }, [nativeText, value]);
  return <SwiftUIHStack spacing={12}>
    <SwiftUIText>Name</SwiftUIText>
    <SwiftUISpacer />
    <SwiftUITextField onTextChange={onChange} text={nativeText} modifiers={[textFieldStyle('plain'), multilineTextAlignment('trailing'), frame({ minWidth: 150 })]} />
  </SwiftUIHStack>;
}

/**
 * Reads as a handle: the @ sits right before the text, like web's username field. The error
 * sits in the row, not the footer, so it stays above the keyboard while typing.
 */
function NativeUsernameRow({ value, onChange, error, errorColor }: { value: string; onChange: (value: string) => void; error: string | null; errorColor: string }) {
  const nativeText = useNativeState(value);
  useEffect(() => { if (nativeText.get() !== value) nativeText.set(value); }, [nativeText, value]);
  return <SwiftUIVStack alignment="leading" spacing={4}>
    <SwiftUIHStack spacing={1}>
      <SwiftUIText modifiers={[foregroundStyle('secondary')]}>@</SwiftUIText>
      <SwiftUITextField onTextChange={onChange} text={nativeText} placeholder="username" modifiers={[textFieldStyle('plain'), textInputAutocapitalization('never'), autocorrectionDisabled(), accessibilityLabel('Username')]} />
    </SwiftUIHStack>
    {error ? <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(errorColor)]}>{error}</SwiftUIText> : null}
  </SwiftUIVStack>;
}

export function EditProfileScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'EditProfile'>) {
  const theme = useAppTheme();
  const user = useSessionStore((state) => state.user);
  const setUser = useSessionStore((state) => state.setUser);
  const updatePrototypeProfile = usePrototypeStore((state) => state.updateProfile);
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [saving, setSaving] = useState(false);
  const avatar = useAvatarActions();
  // A save and a photo change each reply with the whole profile, so they never overlap: the later
  // reply could otherwise put back what the other just changed.
  const photoLocked = avatar.busy || saving;
  const draft = profileDraft(user, name, username);
  const changeUsername = (value: string) => setUsername(normalizeUsername(value));

  const save = useCallback(() => {
    if (!draft.canSave || saving || avatar.busy) return;
    if (!draft.patch.name && !draft.patch.username) { navigation.goBack(); return; }
    setSaving(true);
    void mobileApi.updateProfile(draft.patch).then(async ({ user: next }) => {
      await setUser(next);
      // setUser drops a reply for an account that is no longer active; so does the name shown here.
      if (useSessionStore.getState().user?.id === next.id) updatePrototypeProfile({ name: next.name });
      navigation.goBack();
    }).catch((error) => Alert.alert('Couldn’t update profile', errorMessage(error))).finally(() => setSaving(false));
  }, [avatar.busy, draft.canSave, draft.patch, navigation, saving, setUser, updatePrototypeProfile]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'ios') return;
    navigation.setOptions({
      headerLeft: () => <RNButton title="Cancel" onPress={() => navigation.goBack()} />,
      headerRight: () => saving ? <ActivityIndicator /> : <RNButton title="Done" disabled={!draft.canSave || avatar.busy} onPress={save} />,
    });
  }, [avatar.busy, draft.canSave, navigation, save, saving]);

  const photoLabel = user?.avatarUrl ? 'Edit Photo' : 'Add Photo';

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm modifiers={[scrollDismissesKeyboard('interactively')]}>
    <SwiftUISection>
      <SwiftUIVStack spacing={10} modifiers={[frame({ maxWidth: Infinity }), listRowBackground('clear')]}>
        <SwiftUIRNHostView matchContents><EditableAvatar busy={avatar.busy} /></SwiftUIRNHostView>
        <SwiftUIMenu label={photoLabel} modifiers={[disabled(photoLocked)]}>
          <SwiftUIButton label="Choose Photo" systemImage="photo.on.rectangle" onPress={() => void avatar.choose('library')} />
          <SwiftUIButton label="Take Photo" systemImage="camera" onPress={() => void avatar.choose('camera')} />
          {user?.avatarUrl ? <SwiftUIButton label="Remove Photo" role="destructive" systemImage="trash" onPress={() => void avatar.remove()} /> : null}
        </SwiftUIMenu>
      </SwiftUIVStack>
    </SwiftUISection>
    <SwiftUISection title="Profile" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{NAME_HINT}</SwiftUIText>}>
      <NativeNameRow value={name} onChange={setName} />
      <SwiftUILabeledContent label="Email"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{user?.email ?? ''}</SwiftUIText></SwiftUILabeledContent>
    </SwiftUISection>
    <SwiftUISection title="Username" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{USERNAME_HINT}</SwiftUIText>}>
      <NativeUsernameRow value={username} onChange={changeUsername} error={draft.usernameError} errorColor={theme.red} />
    </SwiftUISection>
  </SwiftUIForm></SwiftUIHost>;

  const openPhotoActions = () => showActions('Profile picture', [
    { label: 'Choose photo', icon: 'photo.on.rectangle', onPress: () => void avatar.choose('library') },
    { label: 'Take photo', icon: 'camera', onPress: () => void avatar.choose('camera') },
    ...(user?.avatarUrl ? [{ label: 'Remove photo', icon: 'trash', destructive: true, onPress: () => void avatar.remove() }] : []),
  ]);

  return <Screen><PageHeader title="Edit Profile" onBack={() => navigation.goBack()} />
    <View style={styles.avatarSection}>
      <Pressable accessibilityRole="button" accessibilityLabel="Change profile picture" disabled={photoLocked} onPress={openPhotoActions}><EditableAvatar busy={avatar.busy} /></Pressable>
      <PrimaryButton label={user?.avatarUrl ? 'Change photo' : 'Add photo'} variant="plain" disabled={photoLocked} onPress={openPhotoActions} />
    </View>
    <Field label="Display name" autoComplete="name" maxLength={120} value={name} onChangeText={setName} />
    <Text style={[styles.helper, { color: theme.secondary, marginBottom: 16 }]}>{NAME_HINT}</Text>
    <Field label="Username" autoComplete="username" autoCapitalize="none" autoCorrect={false} maxLength={30} value={username} onChangeText={changeUsername} error={draft.usernameError ?? undefined} />
    <Text style={[styles.helper, { color: theme.secondary, marginBottom: 16 }]}>{USERNAME_HINT}</Text>
    <Card style={{ marginBottom: 24 }}><ListRow title="Email" value={user?.email ?? ''} last /></Card>
    <PrimaryButton label="Save" loading={saving} disabled={!draft.canSave || avatar.busy} onPress={save} />
  </Screen>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  helper: { fontSize: 12, lineHeight: 18 },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, overflow: 'hidden' },
  avatarBusy: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  avatarSection: { alignItems: 'center', gap: 8, marginBottom: 20 },
});
