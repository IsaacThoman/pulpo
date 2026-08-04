export type SettingsSection = 'general' | 'interface' | 'data' | 'demo';

export type RootStackParamList = {
  Chat: { chatId?: string } | undefined;
  Search: undefined;
  Settings: undefined;
  Account: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  InstanceDetails: undefined;
  SettingsDetail: { section: SettingsSection };
  Trash: undefined;
  SharedChat: { token: string };
};
