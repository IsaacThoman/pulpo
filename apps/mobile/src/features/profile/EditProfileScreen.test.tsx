// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  user: null as unknown as User,
  setUser: vi.fn(),
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  pickAvatar: vi.fn(),
  showActions: vi.fn(),
  alert: vi.fn(),
}))
const { passthrough } = vi.hoisted(() => ({ passthrough: ({ children }: { children?: unknown }) => children }))
vi.mock('react-native', () => ({
  Platform: { get OS() { return mocks.platform } },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Alert: { alert: mocks.alert },
  Linking: { openSettings: vi.fn() },
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => createElement('progress', { 'aria-label': accessibilityLabel }),
  Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, title),
  Pressable: ({ children, onPress, accessibilityLabel }: { children?: ReactNode; onPress: () => void; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}))
vi.mock('@expo/ui/swift-ui', () => ({
  Form: passthrough, Host: passthrough, HStack: passthrough, VStack: passthrough, RNHostView: passthrough, Spacer: () => null,
  Section: ({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) => createElement('section', { 'aria-label': title }, children, footer),
  LabeledContent: ({ label, children }: { label: string; children: ReactNode }) => createElement('div', null, createElement('span', null, label), children),
  Menu: ({ label, children }: { label: string; children: ReactNode }) => createElement('div', { role: 'menu', 'aria-label': label }, children),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  TextField: ({ text, onTextChange }: { text: { get: () => string }; onTextChange: (value: string) => void }) => createElement('input', { defaultValue: text.get(), onChange: (event: { target: { value: string } }) => onTextChange(event.target.value) }),
  useNativeState: (value: string) => ({ get: () => value, set: vi.fn() }),
}))
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(['accessibilityLabel', 'autocorrectionDisabled', 'disabled', 'font', 'foregroundStyle', 'frame', 'listRowBackground', 'multilineTextAlignment', 'scrollDismissesKeyboard', 'textFieldStyle', 'textInputAutocapitalization', 'tint'].map(name => [name, vi.fn()])))
vi.mock('../../api/client', () => ({ mobileApi: { updateProfile: mocks.updateProfile, uploadAvatar: mocks.uploadAvatar, removeAvatar: mocks.removeAvatar } }))
vi.mock('../../store/session', () => ({
  useSessionStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ user: mocks.user, setUser: mocks.setUser }),
    { getState: () => ({ user: mocks.user, setUser: mocks.setUser }) },
  ),
}))
vi.mock('../../platform/materialActions', () => ({ showActions: mocks.showActions }))
vi.mock('../../mockup5/src/store/prototypeStore', () => ({ usePrototypeStore: (selector: (state: unknown) => unknown) => selector({ updateProfile: vi.fn() }) }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ blue: 'blue', red: 'red', secondary: 'gray' }) }))
vi.mock('../../mockup5/src/components/ProfileAvatar', () => ({ ProfileAvatar: () => createElement('img', { alt: 'avatar' }) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  Screen: passthrough, Card: passthrough, PageHeader: ({ title }: { title: string }) => createElement('h1', null, title),
  ListRow: ({ title, value }: { title: string; value?: string }) => createElement('div', null, title, value),
  Field: ({ label, value, onChangeText, error }: { label: string; value: string; onChangeText: (value: string) => void; error?: string }) => createElement('label', null, label, createElement('input', { 'aria-label': label, value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value) }), error),
  PrimaryButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, label),
}))
vi.mock('./avatar', async (importOriginal) => ({ ...await importOriginal<typeof import('./avatar')>(), pickAvatar: mocks.pickAvatar, avatarUploadBody: () => 'form-body' }))
vi.mock('expo-image-picker', () => ({ UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }))
vi.mock('expo-file-system', () => ({ File: class {} }))
import { EditProfileScreen } from './EditProfileScreen'

const account: User = { id: '00000000-0000-4000-8000-000000000001', email: 'isaac@example.test', name: 'Isaac', username: 'isaac', avatarUrl: null, profileColor: null } as User
const navigation = { goBack: vi.fn(), setOptions: vi.fn() }
let header: { headerRight?: () => ReactElement } = {}
navigation.setOptions.mockImplementation((options: typeof header) => { header = options })
const mount = () => render(<EditProfileScreen navigation={navigation as never} route={{ key: 'EditProfile', name: 'EditProfile' } as never} />)
const doneButton = () => render(header.headerRight!()).getByRole('button', { name: 'Done' })

beforeEach(() => { mocks.user = account; mocks.platform = 'ios'; header = {} })
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('saves a changed username from Done on iOS', async () => {
  mocks.updateProfile.mockResolvedValue({ user: { ...account, username: 'new_name' } })
  mount()
  fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: '@New_Name' } })
  fireEvent.click(doneButton())
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled())
  expect(mocks.updateProfile).toHaveBeenCalledWith({ username: 'new_name' })
  expect(mocks.setUser).toHaveBeenCalledWith({ ...account, username: 'new_name' })
})

it('explains an invalid username and keeps Done disabled on iOS', () => {
  mount()
  fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'ab' } })
  expect(screen.getByText(/Use 3–30 letters/)).toBeTruthy()
  expect((doneButton() as HTMLButtonElement).disabled).toBe(true)
})

it('closes without a request when nothing changed', () => {
  mount()
  fireEvent.click(doneButton())
  expect(mocks.updateProfile).not.toHaveBeenCalled()
  expect(navigation.goBack).toHaveBeenCalled()
})

it('uploads a chosen photo and shows the updated account on iOS', async () => {
  const updated = { ...account, avatarUrl: `/api/users/${account.id}/avatar?v=1` }
  mocks.pickAvatar.mockResolvedValue({ uri: 'file:///crop.jpg', name: 'avatar.jpg', mimeType: 'image/jpeg', size: 1000 })
  mocks.uploadAvatar.mockResolvedValue({ user: updated })
  mount()
  expect(screen.getByRole('menu', { name: 'Add Photo' })).toBeTruthy()
  expect(screen.queryByText('Remove Photo')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByText('Choose Photo')) })
  expect(mocks.pickAvatar).toHaveBeenCalledWith('library')
  expect(mocks.uploadAvatar).toHaveBeenCalledWith('form-body')
  expect(mocks.setUser).toHaveBeenCalledWith(updated)
})

it('does not upload photos over the size limit', async () => {
  mocks.pickAvatar.mockResolvedValue({ uri: 'file:///big.jpg', name: 'avatar.jpg', mimeType: 'image/jpeg', size: 6 * 1024 * 1024 })
  mount()
  await act(async () => { fireEvent.click(screen.getByText('Take Photo')) })
  expect(mocks.pickAvatar).toHaveBeenCalledWith('camera')
  expect(mocks.uploadAvatar).not.toHaveBeenCalled()
  expect(mocks.alert).toHaveBeenCalledWith('Couldn’t upload profile picture', 'Profile pictures may be at most 5 MiB')
})

it('removes the photo on iOS', async () => {
  mocks.user = { ...account, avatarUrl: `/api/users/${account.id}/avatar?v=1` }
  mocks.removeAvatar.mockResolvedValue({ user: { ...account, avatarUrl: null } })
  mount()
  expect(screen.getByRole('menu', { name: 'Edit Photo' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByText('Remove Photo')) })
  expect(mocks.setUser).toHaveBeenCalledWith({ ...account, avatarUrl: null })
})

it('saves the name and username together on Android', async () => {
  mocks.platform = 'android'
  mocks.updateProfile.mockResolvedValue({ user: { ...account, name: 'Isaac T', username: 'isaac_t' } })
  mount()
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Isaac T ' } })
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Isaac_T' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled())
  expect(mocks.updateProfile).toHaveBeenCalledWith({ name: 'Isaac T', username: 'isaac_t' })
})

it('offers photo actions in a Material sheet on Android', async () => {
  mocks.platform = 'android'
  mocks.pickAvatar.mockResolvedValue(null)
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))
  const [title, actions] = mocks.showActions.mock.calls[0] as [string, { label: string; onPress: () => void }[]]
  expect(title).toBe('Profile picture')
  expect(actions.map((action) => action.label)).toEqual(['Choose photo', 'Take photo'])
  await act(async () => { actions[0]!.onPress() })
  expect(mocks.pickAvatar).toHaveBeenCalledWith('library')
  expect(mocks.uploadAvatar).not.toHaveBeenCalled()
})
