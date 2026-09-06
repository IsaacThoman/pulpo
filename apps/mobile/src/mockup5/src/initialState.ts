import type { PersistedPrototypeState } from './domain';

export function createInitialState(): PersistedPrototypeState {
  return {
    instance: {
      url: 'https://pulpo.baby',
      name: 'Pulpo',
      version: '',
      signupOpen: false,
      connectedAt: 0,
    },
    session: { status: 'signed-out', user: null },
    models: [],
    defaultModelId: '',
    chats: [],
    folders: [],
    preferences: {
      theme: 'system',
      textSize: 'default',
      sendWithEnter: true,
      streamResponses: true,
      showPromptSuggestions: true, showReasoning: true,
      memoryEnabled: false,
      haptics: true,
      localChatLimit: 50,
      attachmentCacheMb: 50,
      trashRetention: '30d',
      automaticChatExpiration: '24h',
      newChatAutoExpire: false,
    },
  };
}
