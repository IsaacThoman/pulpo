export type SettingsSection = 'general' | 'interface' | 'data';

export type RootStackParamList = {
  Chat: { chatId?: string } | undefined;
  Settings: undefined;
  Account: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  InstanceDetails: undefined;
  SettingsDetail: { section: SettingsSection };
  Trash: undefined;
};
