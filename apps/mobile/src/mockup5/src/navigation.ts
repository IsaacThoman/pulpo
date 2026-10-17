export type SettingsSection = 'general' | 'interface' | 'personalization' | 'data';

export type RootStackParamList = {
  Chat: { chatId?: string } | undefined;
  Settings: undefined;
  Account: undefined;
  DeleteAccount: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  TwoFactor: undefined;
  Passkeys: undefined;
  Devices: undefined;
  InstanceDetails: undefined;
  SettingsDetail: { section: SettingsSection };
  Trash: undefined;
  /** A Files folder; null is the top of My files. */
  FilesFolder: { folderId: string | null; name?: string };
  /** A collaborative document; `created` opens a new one ready to type in. */
  FileDocument: { fileId: string; name?: string; created?: boolean };
  /** An uploaded Markdown file: read only until it is made editable. */
  FileMarkdown: { fileId: string; name?: string };
};
