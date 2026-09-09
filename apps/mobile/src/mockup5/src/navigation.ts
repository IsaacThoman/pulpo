export type SettingsSection = 'general' | 'interface' | 'data' | 'speech' | 'imageGeneration';

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
};
