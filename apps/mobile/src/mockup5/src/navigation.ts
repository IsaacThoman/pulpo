export type SettingsSection = 'general' | 'interface' | 'personalization' | 'data' | 'trash';

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
  /** A Files folder; null is the top of My files, and trash references (features/trash/folder.ts) the trash. */
  FilesFolder: { folderId: string | null; name?: string };
  /** A collaborative document; `created` opens a new one ready to type in. */
  FileDocument: { fileId: string; name?: string; created?: boolean };
  /** An uploaded Markdown file: read only until it is made editable. */
  FileMarkdown: { fileId: string; name?: string };
  /** A quiz to take: a `.quiz` file in Files, or one already on the device (a chat attachment). */
  FileQuiz: { fileId: string; name?: string } | { uri: string; name: string };
};
