import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Appearance,
  type ColorValue,
  DynamicColorIOS,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  type ScrollViewProps,
  SectionList,
  Share,
  StyleSheet,
  Text as RNText,
  TextInput,
  type TextProps,
  type ImageSourcePropType,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BottomSheet as SwiftUIBottomSheet,
  Button as SwiftUIButton,
  ContextMenu as SwiftUIContextMenu,
  ControlGroup as SwiftUIControlGroup,
  Divider as SwiftUIDivider,
  Form as SwiftUIForm,
  Group as SwiftUIGroup,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  Image as SwiftUIImage,
  Label as SwiftUILabel,
  Menu as SwiftUIMenu,
  RNHostView as SwiftUIRNHostView,
  Section as SwiftUISection,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  TextField as SwiftUITextField,
  type TextFieldRef as SwiftUITextFieldRef,
  VStack as SwiftUIVStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint as swiftUIAccessibilityHint,
  accessibilityLabel as swiftUIAccessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  brightness,
  contentShape,
  controlSize,
  disabled as swiftUIDisabled,
  foregroundStyle,
  font,
  frame,
  grayscale,
  labelStyle,
  menuActionDismissBehavior,
  padding,
  resizable,
  shapes,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ExpoHaptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationLightTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Brain,
  FilePenLine,
  FileText,
  FolderSearch,
  Ghost,
  List,
  Loader2,
  Minimize2,
  Search,
  Server,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  type KeyboardChatScrollViewRef,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Reanimated, {
  cancelAnimation,
  FadeInUp,
  FadeOutUp,
  interpolate,
  interpolateColor,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthExperience } from './src/screens/AuthExperience';
import {
  AccountScreen,
  ChangePasswordScreen,
  EditProfileScreen,
  InstanceDetailsScreen,
  MemberSettingsScreen,
  SettingsDetailScreen,
  TwoFactorScreen,
  TrashScreen,
} from './src/screens/MemberScreens';
import type { RootStackParamList } from './src/navigation';
import { usePrototypeStore } from './src/store/prototypeStore';
import type { ActivityStep, PrototypeChat, PrototypeMessage, PrototypeModel, ResponseBranch } from './src/domain';
import { chatRemovalBehavior } from './src/chatRemoval';
import { resolveDisplayModel } from './src/modelIdentity';
import { useSessionStore } from '../store/session';
import type { ServerChat } from '../types';
import { apiRequest, ApiError } from '../api/client';
import { clearProductionScope, hydrateProductionScope, ProductionBridge } from './src/production/ProductionBridge';
import { productionActions, runProductionAction } from './src/production/productionActions';
import { applyConfirmedMessageDeletion, cacheOptimisticBranch, cacheOptimisticTurn, discardOptimisticChat, rejectOptimisticTurn } from './src/production/optimisticResponses';
import { activateOptimisticBranch } from './src/production/optimisticBranches';
import { cacheNamespace, deleteResponseCursor } from '../data/database';
import { queryKeys } from '../data/queries';
import { activateBranch as activateServerBranch, cancelResponse, continueWithoutAgent, deleteMessageCascade as deleteServerMessage, deleteUnreferencedAttachment, downloadAttachment, downloadAttachmentThumbnail, duplicateChat as duplicateServerChat, editMessage as editServerMessage, persistChat as persistServerChat, regenerateResponse as regenerateServerResponse, sendMessage as sendServerMessage, shareAttachment as shareServerAttachment, shareChat as shareServerChat, startChat as startServerChat, uploadAttachment } from '../features/chat/api';
import { subscribeToResponse, useRealtimeStore } from '../providers/realtimeStore';
import { shouldShowConnectionBanner } from '../providers/realtimeConnection';
import { usePreferencesStore } from '../store/preferences';
import { orderedModelsById, resolveVisibleOrder } from '../features/chat/modelPreferences';
import { aiIconSource } from './src/production/AiIconAssets';
import { SafeMarkdown } from '../components/SafeMarkdown';
import { timeAgo } from '../features/chat/format';
import { generationSummary, resolveGenerationSelections, type GenerationSelections } from '../features/chat/generationOptions';
import {
  historyChatSummary,
  reuseHistoryChatSummaries,
  visibleHistoryChats,
  type HistoryChatSummary,
} from '../features/chat/history';
import { activityDurationMs, buildLegacyMessageTimeline, buildMessageTimeline, completedActivityLabel, timelineActivityIsActive, workspaceIsActive, type TimelineStep } from '../features/chat/timeline';
import { isNearChatBottom, resolveKeyboardLayoutProgress, shouldFollowChatContent } from '../features/chat/viewport';
import { nextChatStartsTemporary, resolveChatHeaderAction } from '../features/chat/headerAction';
import { copyFile, supportsFileClipboard } from '../native/fileClipboard';
import {
  HistoryChatContextMenuView,
  type HistoryChatContextMenuAction,
} from '../native/HistoryChatContextMenuView';
import { TemporaryChatHeaderView as PersistentNativeTemporaryChatHeaderView } from '../native/TemporaryChatHeaderView';
import {
  CHAT_CONTENT_MAX,
  DRAWER_MAX_WIDTH,
  DRAWER_TRAILING_PEEK,
  responsiveHorizontalPadding,
  SIDEBAR_WIDTH,
  usesPersistentSidebar,
} from '../responsive';

type ChatScrollViewProps = ScrollViewProps & {
  freezeKeyboardLayout: boolean;
  keyboardOffset: number;
};

const ChatScrollView = forwardRef<KeyboardChatScrollViewRef, ChatScrollViewProps>(({
  freezeKeyboardLayout,
  keyboardOffset,
  ...props
}, ref) => (
  <KeyboardChatScrollView
    {...props}
    automaticallyAdjustContentInsets={false}
    contentInsetAdjustmentBehavior="never"
    freeze={freezeKeyboardLayout}
    keyboardLiftBehavior="whenAtEnd"
    offset={keyboardOffset}
    ref={ref}
  />
));

ChatScrollView.displayName = 'ChatScrollView';

function systemColor(ios: string, android: string, fallback: string): ColorValue {
  if (Platform.OS === 'ios') return PlatformColor(ios);
  if (Platform.OS === 'android') return PlatformColor(android);
  return fallback;
}

function readableColor(light: string, dark: string, android: string, fallback = light): ColorValue {
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark });
  if (Platform.OS === 'android') return PlatformColor(android);
  return fallback;
}

// Native semantic colors automatically follow the device's appearance and contrast settings.
const COLORS = {
  background: systemColor('systemBackground', '?attr/colorBackground', '#ffffff'),
  panel: systemColor('secondarySystemBackground', '?attr/colorBackgroundFloating', '#f2f2f7'),
  card: systemColor('secondarySystemGroupedBackground', '?attr/colorBackgroundFloating', '#ffffff'),
  secondary: systemColor('tertiarySystemFill', '?attr/colorControlHighlight', '#d1d1d6'),
  elevated: systemColor('secondarySystemBackground', '?attr/colorBackgroundFloating', '#f2f2f7'),
  line: systemColor('separator', '?attr/colorControlNormal', '#c6c6c8'),
  lineSoft: systemColor('opaqueSeparator', '?attr/colorControlNormal', '#c6c6c8'),
  text: systemColor('label', '?attr/textColorPrimary', '#000000'),
  textSoft: systemColor('label', '?attr/textColorPrimary', '#000000'),
  muted: readableColor('#68686F', '#A1A1A8', '?attr/textColorSecondary'),
  dim: systemColor('tertiaryLabel', '?attr/textColorSecondary', '#3c3c434d'),
  fill: systemColor('tertiarySystemFill', '?attr/colorControlHighlight', '#7676801f'),
  fillStrong: systemColor('secondarySystemFill', '?attr/colorControlHighlight', '#78788029'),
  accent: systemColor('systemBlue', '?attr/colorAccent', '#007aff'),
  positive: systemColor('systemGreen', '?attr/colorAccent', '#34c759'),
  critical: readableColor('#C5221F', '#FF8A84', '?attr/colorError'),
  criticalAction: readableColor('#A91511', '#FFB0AB', '?attr/colorError'),
  warning: readableColor('#A24B00', '#FFB15A', '?attr/colorAccent'),
  foregroundOnAccent: '#ffffff',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
};

const DRAWER_ACTION_HEIGHT = 46;

let hapticsEnabled = true;

const Haptics = {
  ...ExpoHaptics,
  impactAsync: (style: ExpoHaptics.ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle.Medium) => (
    hapticsEnabled ? ExpoHaptics.impactAsync(style) : Promise.resolve()
  ),
  notificationAsync: (type: ExpoHaptics.NotificationFeedbackType = ExpoHaptics.NotificationFeedbackType.Success) => (
    hapticsEnabled ? ExpoHaptics.notificationAsync(type) : Promise.resolve()
  ),
  selectionAsync: () => hapticsEnabled ? ExpoHaptics.selectionAsync() : Promise.resolve(),
};

type AppTheme = 'System' | 'Light' | 'Dark';
type AppTextSize = 'Default' | 'Large' | 'Extra Large';
type AppPreferences = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  textSize: AppTextSize;
  setTextSize: (size: AppTextSize) => void;
  smoothStreaming: boolean;
  setSmoothStreaming: (enabled: boolean) => void;
  showReasoning: boolean;
  setShowReasoning: (enabled: boolean) => void;
  haptics: boolean;
  setHaptics: (enabled: boolean) => void;
};

const AppPreferencesContext = createContext<AppPreferences>({
  theme: 'System',
  setTheme: () => {},
  textSize: 'Default',
  setTextSize: () => {},
  smoothStreaming: true,
  setSmoothStreaming: () => {},
  showReasoning: true,
  setShowReasoning: () => {},
  haptics: true,
  setHaptics: () => {},
});

function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const preferences = usePrototypeStore((state) => state.preferences);
  const setPreference = usePrototypeStore((state) => state.setPreference);
  const theme = ({ system: 'System', light: 'Light', dark: 'Dark' } as const)[preferences.theme];
  const textSize = ({ default: 'Default', large: 'Large', 'extra-large': 'Extra Large' } as const)[preferences.textSize];
  const smoothStreaming = preferences.streamResponses;
  const showReasoning = preferences.showReasoning;
  const haptics = preferences.haptics;

  useEffect(() => {
    hapticsEnabled = haptics;
  }, [haptics]);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setPreference('theme', nextTheme.toLowerCase() as 'system' | 'light' | 'dark');
    Appearance.setColorScheme(nextTheme === 'System' ? 'unspecified' : nextTheme.toLowerCase() as 'light' | 'dark');
  }, [setPreference]);
  const setTextSize = useCallback((nextSize: AppTextSize) => {
    setPreference('textSize', ({ Default: 'default', Large: 'large', 'Extra Large': 'extra-large' } as const)[nextSize]);
  }, [setPreference]);
  const setSmoothStreaming = useCallback((enabled: boolean) => setPreference('streamResponses', enabled), [setPreference]);
  const setShowReasoning = useCallback((enabled: boolean) => setPreference('showReasoning', enabled), [setPreference]);
  const setHaptics = useCallback((enabled: boolean) => {
    hapticsEnabled = enabled;
    setPreference('haptics', enabled);
  }, [setPreference]);
  const value = useMemo(() => ({
    theme,
    setTheme,
    textSize,
    setTextSize,
    smoothStreaming,
    setSmoothStreaming,
    showReasoning,
    setShowReasoning,
    haptics,
    setHaptics,
  }), [haptics, setHaptics, setShowReasoning, setSmoothStreaming, setTextSize, setTheme, showReasoning, smoothStreaming, textSize, theme]);

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

function useAppPreferences() {
  return useContext(AppPreferencesContext);
}

function Text({ style, ...props }: TextProps) {
  const { textSize } = useAppPreferences();
  const scale = textSize === 'Large' ? 1.12 : textSize === 'Extra Large' ? 1.25 : 1;
  const flattened = StyleSheet.flatten(style);
  const scaledStyle = scale === 1 ? null : {
    fontSize: flattened?.fontSize ? flattened.fontSize * scale : undefined,
    lineHeight: flattened?.lineHeight ? flattened.lineHeight * scale : undefined,
  };
  return <RNText {...props} style={[style, scaledStyle]} />;
}

type AccessibilityPreferences = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
};

const AccessibilityPreferencesContext = createContext<AccessibilityPreferences>({
  reduceMotion: false,
  reduceTransparency: false,
});

function AccessibilityPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>({
    reduceMotion: false,
    reduceTransparency: false,
  });

  useEffect(() => {
    let mounted = true;
    Promise.all([
      AccessibilityInfo.isReduceMotionEnabled(),
      AccessibilityInfo.isReduceTransparencyEnabled(),
    ]).then(([reduceMotion, reduceTransparency]) => {
      if (mounted) setPreferences({ reduceMotion, reduceTransparency });
    });
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduceMotion) => {
      setPreferences((current) => ({ ...current, reduceMotion }));
    });
    const transparencySubscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (reduceTransparency) => {
      setPreferences((current) => ({ ...current, reduceTransparency }));
    });
    return () => {
      mounted = false;
      motionSubscription.remove();
      transparencySubscription.remove();
    };
  }, []);

  return (
    <AccessibilityPreferencesContext.Provider value={preferences}>
      {children}
    </AccessibilityPreferencesContext.Provider>
  );
}

function useAccessibilityPreferences() {
  return useContext(AccessibilityPreferencesContext);
}

type SymbolName = ComponentProps<typeof SymbolView>['name'];

type Model = { id: string; redirectTargetModelIds?: string[]; name: string; providerGroupId: string; lab: string; icon: ImageSourcePropType; labIcon?: ImageSourcePropType; menuIcon?: ImageSourcePropType; tintColor?: ColorValue; detail: string; agentEnabled: boolean };
type ModelSection = string;
type Attachment = {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  size?: number;
  kind: 'image' | 'file';
};
type ComposerAttachment = Attachment & {
  localId: string;
  serverId?: string;
  state: 'local' | 'uploading' | 'ready' | 'failed';
  error?: string;
};
type PreparedAttachment = ComposerAttachment & { serverId: string; state: 'ready' };

const SUPPORTED_RASTER_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

function attachmentKind(mimeType: string): Attachment['kind'] {
  return SUPPORTED_RASTER_IMAGE_MIME_TYPES.has(mimeType.toLowerCase()) ? 'image' : 'file';
}

type Message = {
  id: string;
  chatId?: string;
  chatModelId?: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt?: number;
  latencyMs?: number;
  modelId?: string;
  attachments?: Attachment[];
  thinkSeconds?: number;
  reasoning?: string;
  meta?: string;
  activity?: ActivityStep[];
  outputItems?: unknown[];
  status?: PrototypeMessage['status'];
  error?: string;
  branches?: ResponseBranch[];
  activeBranch?: number;
  agentMode?: boolean;
};
type Chat = { id: string; title: string; modelId: string; time: string; section: string; messages: Message[] };
type StreamingSession = {
  id: string;
  chatKey: string;
  modelId: string;
  response: string;
  thinkSeconds: number;
};
type SendOptions = { presetSelections: GenerationSelections; agentEnabled: boolean; temporary: boolean };
type MessageEditSession = {
  message: Message;
  originalAttachmentIds: Set<string>;
};
type ChatFollowSnapshot = {
  nearBottom: boolean;
  autoFollow: boolean;
  readerInteracting: boolean;
  tailPending: boolean;
  revision: number;
};

const MODELS: Model[] = [
  { id: 'demo-claude', name: 'Claude Sonnet 4', providerGroupId: 'anthropic', lab: 'Anthropic', icon: require('./assets/model-claude.png'), detail: 'Balanced reasoning and speed', agentEnabled: true },
  { id: 'demo-gpt', name: 'GPT-5', providerGroupId: 'openai', lab: 'OpenAI', icon: require('./assets/model-openai.png'), menuIcon: require('./assets/model-openai-menu.png'), tintColor: COLORS.textSoft, detail: 'Strong general intelligence', agentEnabled: true },
  { id: 'demo-gemini', name: 'Gemini 2.5 Pro', providerGroupId: 'google', lab: 'Google', icon: require('./assets/model-gemini.png'), detail: '1M context · Vision', agentEnabled: true },
  { id: 'demo-deepseek', name: 'DeepSeek R1', providerGroupId: 'deepseek', lab: 'DeepSeek', icon: require('./assets/model-deepseek.png'), detail: 'Deep reasoning traces', agentEnabled: false },
];

const UNAVAILABLE_MODEL: Model = {
  id: '',
  name: 'No model available',
  providerGroupId: 'pulpo',
  lab: 'Pulpo',
  icon: require('./assets/pulpo-smiley.png'),
  detail: 'Ask an administrator to enable a model',
  agentEnabled: false,
};

const LOADING_MODEL: Model = {
  ...UNAVAILABLE_MODEL,
  name: 'Loading models…',
  detail: 'Your available models are loading in the background',
};

function prototypeModelToLegacy(model: PrototypeModel, isDark: boolean): Model {
  const template = MODELS.find((candidate) => candidate.lab === model.lab)
    ?? MODELS[{ claude: 0, openai: 1, gemini: 2, deepseek: 3 }[model.asset]]
    ?? MODELS[1];
  const icon = aiIconSource(model.modelLogo ?? model.labLogo, isDark, model.modelCustomIcon);
  return { ...template, id: model.id, redirectTargetModelIds: model.redirectTargetModelIds, name: model.name, providerGroupId: model.providerGroupId, lab: model.lab, detail: model.description, icon, menuIcon: icon, labIcon: aiIconSource(model.labLogo, isDark, model.labCustomIcon), tintColor: undefined, agentEnabled: model.agentEnabled };
}

const REASONING_SAMPLE =
  'The user wants a practical answer, not an architecture lecture. Lead with the state boundary: durable messages in the store, transient tokens in the view. Mention the commit-once pattern and why it keeps rendering cheap.';

const legacyMessageCache = new WeakMap<PrototypeMessage, { chatId: string; chatModelId: string; value: Message }>();
const legacyChatCache = new WeakMap<PrototypeChat, Chat>();

function prototypeMessageToLegacy(message: PrototypeMessage, chatId: string, chatModelId: string): Message {
  const cached = legacyMessageCache.get(message);
  if (cached?.chatId === chatId && cached.chatModelId === chatModelId) return cached.value;
  const reasoning = message.activity?.find((step) => step.kind === 'reasoning')?.detail;
  const value: Message = {
    id: message.id,
    chatId,
    chatModelId,
    role: message.role,
    text: message.branches?.[message.activeBranch ?? 0]?.text ?? message.text,
    createdAt: message.createdAt,
    latencyMs: message.latencyMs,
    modelId: message.modelId,
    attachments: message.attachments?.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      uri: attachment.uri ?? '',
      mimeType: attachment.mimeType,
      size: attachment.sizeBytes,
      kind: attachment.kind,
    })),
    thinkSeconds: message.activity?.length
      ? Math.max(1, Math.round(message.activity.reduce((sum, step) => sum + step.durationMs, 0) / 1000))
      : undefined,
    reasoning,
    meta: message.meta,
    error: message.error,
    activity: message.activity,
    outputItems: message.outputItems,
    status: message.status,
    branches: message.branches,
    activeBranch: message.activeBranch,
    agentMode: message.agentMode,
  };
  legacyMessageCache.set(message, { chatId, chatModelId, value });
  return value;
}

function prototypeChatToLegacy(chat: PrototypeChat): Chat {
  const cached = legacyChatCache.get(chat);
  if (cached) return cached;
  const summary = historyChatSummary(chat);
  const value = {
    id: chat.id,
    title: chat.title,
    modelId: chat.modelId,
    time: summary.time,
    section: summary.section,
    messages: chat.messages.map((message) => prototypeMessageToLegacy(message, chat.id, chat.modelId)),
  };
  legacyChatCache.set(chat, value);
  return value;
}

type SuggestedPrompt = { id: string; label: string; message: string };

const DEFAULT_SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { id: '1', label: 'What can you help me build today?', message: 'What can you help me build today?' },
  { id: '2', label: 'Explain how KV caching speeds up decoding', message: 'Explain how KV caching speeds up decoding' },
  { id: '3', label: 'Draft a terse commit message for a sidebar refactor', message: 'Draft a terse commit message for a sidebar refactor' },
  { id: '4', label: 'Compare mixture-of-experts vs dense models', message: 'Compare mixture-of-experts vs dense models' },
];

function pickSuggestedPrompts(items: SuggestedPrompt[], count: number): SuggestedPrompt[] {
  if (count <= 0 || items.length === 0) return [];
  const pool = [...items];
  const result: SuggestedPrompt[] = [];
  const uniqueCount = Math.min(count, pool.length);
  for (let index = 0; index < uniqueCount; index += 1) {
    result.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
  while (result.length < count) result.push(items[Math.floor(Math.random() * items.length)]!);
  return result;
}

function Icon({ name, size = 20, color = COLORS.text, weight = 'regular' }: { name: SymbolName; size?: number; color?: ColorValue; weight?: ComponentProps<typeof SymbolView>['weight'] }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} />;
}

type NativeButtonSystemImage = NonNullable<ComponentProps<typeof SwiftUIButton>['systemImage']>;

function NativeComposerIconButton({
  label,
  systemImage,
  onPress,
  disabled = false,
  prominent = false,
}: {
  label: string;
  systemImage: NativeButtonSystemImage;
  onPress: () => void;
  disabled?: boolean;
  prominent?: boolean;
}) {
  const colorScheme = useColorScheme();
  const prominentTint = colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e';
  const prominentForeground = colorScheme === 'dark' || disabled ? '#1c1c1e' : '#ffffff';
  return (
    <SwiftUIHost ignoreSafeArea="keyboard" style={styles.nativeComposerCircleHost}>
      <SwiftUIButton
        label={label}
        onPress={onPress}
        systemImage={systemImage}
        modifiers={[
          buttonStyle(prominent ? 'glassProminent' : 'glass'),
          buttonBorderShape('circle'),
          controlSize('regular'),
          labelStyle('iconOnly'),
          ...(prominent ? [tint(prominentTint)] : []),
          ...(prominent ? [foregroundStyle(prominentForeground)] : []),
          swiftUIDisabled(disabled),
          swiftUIAccessibilityLabel(label),
        ]}
      />
    </SwiftUIHost>
  );
}

function NativeAttachmentMenu({ onTakePhoto, onPickPhotos, onPickFiles }: {
  onTakePhoto: () => void;
  onPickPhotos: () => void;
  onPickFiles: () => void;
}) {
  return (
    <SwiftUIHost ignoreSafeArea="keyboard" style={styles.nativeComposerCircleHost}>
      <SwiftUIMenu
        label="Add attachment"
        systemImage="plus"
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('regular'),
          labelStyle('iconOnly'),
          swiftUIAccessibilityLabel('Add attachment'),
        ]}
      >
        <SwiftUIButton label="Take Photo" systemImage="camera" onPress={onTakePhoto} />
        <SwiftUIButton label="Photo Library" systemImage="photo.on.rectangle" onPress={onPickPhotos} />
        <SwiftUIButton label="Choose Files" systemImage="doc" onPress={onPickFiles} />
      </SwiftUIMenu>
    </SwiftUIHost>
  );
}

function AttachmentStrip({ attachments, onRemove, onRetry }: {
  attachments: ComposerAttachment[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.attachmentStripContent}
      showsHorizontalScrollIndicator={false}
      style={styles.attachmentStrip}
    >
      {attachments.map((attachment) => (
        <View key={attachment.localId} style={styles.attachmentFrame}>
          <View style={attachment.kind === 'image' ? styles.imageAttachment : styles.fileAttachment}>
            {attachment.kind === 'image' ? (
              attachment.uri
                ? <Image accessibilityLabel={attachment.name} source={{ uri: attachment.uri }} style={styles.attachmentImage} />
                : <ResolvedAttachmentImage attachment={attachment} variant="composer" />
            ) : (
              <>
                <View style={styles.fileAttachmentIcon}><Icon name="doc.fill" size={22} color={COLORS.muted} /></View>
                <View style={styles.fileAttachmentCopy}>
                  <Text numberOfLines={1} style={styles.fileAttachmentName}>{attachment.name}</Text>
                  <Text style={styles.fileAttachmentMeta}>{formatAttachmentSize(attachment.size)}</Text>
                </View>
              </>
            )}
            <Pressable
              accessibilityLabel={`Remove ${attachment.name}`}
              accessibilityRole="button"
              disabled={attachment.state === 'uploading'}
              onPress={() => onRemove(attachment.localId)}
              style={styles.removeAttachmentHitTarget}
            >
              <View style={styles.removeAttachmentButton}>
                <Icon name="xmark" size={9} color="#ffffff" weight="bold" />
              </View>
            </Pressable>
          </View>
          {attachment.state === 'uploading' ? <Text style={styles.attachmentUploadStatus}>Uploading…</Text> : null}
          {attachment.state === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={() => onRetry(attachment.localId)}>
              <Text numberOfLines={1} style={[styles.attachmentUploadStatus, styles.attachmentUploadFailed]}>Retry · {attachment.error ?? 'Upload failed'}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function formatAttachmentSize(size?: number) {
  if (!size) return 'Document';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const PULPO_MARK_SOURCE = require('./assets/pulpo-smiley.png') as ImageSourcePropType;
const PULPO_MARK_URI = Image.resolveAssetSource(PULPO_MARK_SOURCE).uri;

function PulpoMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      accessibilityLabel="Pulpo"
      source={PULPO_MARK_SOURCE}
      style={[styles.pulpoMark, { width: size, height: size, borderRadius: size / 2 }]}
    />
  );
}

type GlassProps = Omit<ComponentProps<typeof GlassView>, 'isInteractive'> & {
  interactive?: boolean;
};

function Glass({ children, style, interactive = false, tintColor, ...props }: GlassProps) {
  const colorScheme = useColorScheme();
  const { reduceTransparency } = useAccessibilityPreferences();
  const available = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && !reduceTransparency;
  if (!available) return <View {...props} style={[styles.glassFallback, style]}>{children}</View>;
  return (
    <GlassView {...props} colorScheme={colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : undefined} glassEffectStyle="regular" isInteractive={interactive} style={style} tintColor={tintColor}>
      {children}
    </GlassView>
  );
}

function RoundButton({ icon, onPress, accessibilityLabel, selected = false, size = 44 }: { icon: SymbolName | 'ghost'; onPress: () => void; accessibilityLabel: string; selected?: boolean; size?: number }) {
  const colorScheme = useColorScheme();
  const selectedForeground = colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e';
  const ghostColor = selectedForeground;
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost key={selected ? 'selected' : 'default'} matchContents style={{ width: size, height: size }}>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            buttonStyle(selected ? 'glassProminent' : 'glass'),
            buttonBorderShape('circle'),
            controlSize('regular'),
            ...(selected ? [tint('rgba(175,82,222,0.22)'), foregroundStyle(selectedForeground)] : []),
            swiftUIAccessibilityLabel(accessibilityLabel),
          ]}
        >
          {icon === 'ghost' ? (
            <SwiftUIRNHostView matchContents>
              <View pointerEvents="none" style={styles.roundButtonCustomIcon}>
                <Ghost color={ghostColor} size={18} strokeWidth={2} />
              </View>
            </SwiftUIRNHostView>
          ) : (
            <SwiftUIImage systemName={icon as NativeButtonSystemImage} size={18} modifiers={[frame({ width: 28, height: 28 })]} />
          )}
        </SwiftUIButton>
      </SwiftUIHost>
    );
  }
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} hitSlop={8}>
      {({ pressed }) => (
        <Glass interactive style={[styles.roundButton, { width: size, height: size, borderRadius: size / 2 }, selected && styles.roundButtonSelected, pressed && styles.pressed]}>
          {icon === 'ghost'
            ? <Ghost color={selected ? '#AF52DE' : ghostColor} size={size * 0.44} strokeWidth={2} />
            : <Icon name={icon} size={size * 0.44} color={selected ? '#AF52DE' : COLORS.text} />}
        </Glass>
      )}
    </Pressable>
  );
}

function HeaderActionGlyph({ name }: { name: 'bookmark' | 'square.and.pencil' }) {
  if (Platform.OS === 'ios') {
    return (
      <View pointerEvents="none" style={styles.headerActionGlyphHost}>
        <SwiftUIHost matchContents style={styles.headerActionGlyphHost}>
          <SwiftUIImage systemName={name} size={18} modifiers={[frame({ width: 28, height: 28 })]} />
        </SwiftUIHost>
      </View>
    );
  }
  return <Icon name={name} size={44 * 0.44} color={COLORS.text} />;
}

type TemporaryChatHeaderControlProps = {
  active: boolean;
  expanded: boolean;
  saving: boolean;
  saveDisabled: boolean;
  onToggleTemporary: () => void;
  onSave: () => void;
  onNewChat: () => void;
};

function FallbackTemporaryChatHeaderControl({
  active,
  expanded,
  saving,
  saveDisabled,
  onToggleTemporary,
  onSave,
  onNewChat,
}: TemporaryChatHeaderControlProps) {
  const colorScheme = useColorScheme();
  const { reduceMotion } = useAccessibilityPreferences();
  const iconColor = colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e';
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const expansion = useSharedValue(expanded ? 1 : 0);
  const containerStyle = useAnimatedStyle(() => ({
    width: interpolate(expansion.value, [0, 1], [44, 88]),
  }));
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: 1 - expansion.value,
    transform: [{ scale: interpolate(expansion.value, [0, 1], [1, 0.72]) }],
  }));
  const bookmarkStyle = useAnimatedStyle(() => ({
    opacity: expansion.value,
    transform: [
      { translateX: interpolate(expansion.value, [0, 1], [10, 0]) },
      { scale: interpolate(expansion.value, [0, 1], [0.82, 1]) },
    ],
  }));
  const newChatStyle = useAnimatedStyle(() => ({
    opacity: expansion.value,
    transform: [{ scale: interpolate(expansion.value, [0, 1], [0.72, 1]) }],
  }));

  useEffect(() => {
    const target = expanded ? 1 : 0;
    expansion.value = reduceMotion
      ? target
      : withSpring(target, {
          damping: 18,
          stiffness: 220,
          mass: 0.8,
        });
  }, [expanded, expansion, reduceMotion]);

  return (
    <Reanimated.View style={[styles.temporaryHeaderActionsShell, containerStyle]}>
      <Glass
        interactive
        accessibilityActions={expanded ? [
          { name: 'activate', label: 'Save chat' },
          { name: 'new-chat', label: 'New temporary chat' },
        ] : undefined}
        accessibilityHint={expanded ? 'Tap the left side to save or the right side to start a new temporary chat.' : undefined}
        accessibilityLabel={expanded ? saving ? 'Saving chat' : 'Temporary chat actions' : active ? 'Disable temporary chat' : 'Enable temporary chat'}
        accessibilityRole="button"
        onAccessibilityTap={() => {
          if (!expanded) {
            onToggleTemporary();
          } else if (!saveDisabled && !saving) {
            onSave();
          }
        }}
        onAccessibilityAction={(event) => {
          if (!expanded) {
            onToggleTemporary();
          } else if (event.nativeEvent.actionName === 'new-chat') {
            onNewChat();
          } else if (!saveDisabled && !saving) {
            onSave();
          }
        }}
        onTouchStart={(event) => {
          touchStart.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start || Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 10) return;
          if (expanded && event.nativeEvent.locationX >= 44) {
            onNewChat();
          } else if (expanded) {
            if (!saveDisabled && !saving) onSave();
          } else {
            onToggleTemporary();
          }
        }}
        style={styles.temporaryHeaderActions}
        tintColor={active ? colorScheme === 'dark' ? 'rgba(88,28,135,0.32)' : 'rgba(175,82,222,0.16)' : undefined}
      >
        <Reanimated.View pointerEvents="none" style={[styles.temporaryHeaderPrimaryAction, bookmarkStyle]}>
          <View style={styles.temporaryHeaderAction}>
            {saving
              ? <ActivityIndicator color={iconColor} size="small" />
              : <HeaderActionGlyph name="bookmark" />}
          </View>
        </Reanimated.View>
        <View style={[styles.temporaryHeaderAction, styles.temporaryHeaderNewChatAction]}>
          <Reanimated.View pointerEvents="none" style={[styles.temporaryHeaderIconLayer, ghostStyle]}>
            <Ghost color={iconColor} size={18} strokeWidth={2} />
          </Reanimated.View>
          <Reanimated.View pointerEvents="none" style={[styles.temporaryHeaderIconLayer, newChatStyle]}>
            <HeaderActionGlyph name="square.and.pencil" />
          </Reanimated.View>
        </View>
      </Glass>
    </Reanimated.View>
  );
}

function TemporaryChatHeaderControl(props: TemporaryChatHeaderControlProps) {
  const { reduceMotion } = useAccessibilityPreferences();
  return Platform.OS === 'ios'
    ? (
      <PersistentNativeTemporaryChatHeaderView
        {...props}
        reduceMotion={reduceMotion}
        style={{ width: 88, height: 44 }}
      />
    )
    : <FallbackTemporaryChatHeaderControl {...props} />;
}

function AppHeader({ children }: { children: ReactNode }) {
  return <View pointerEvents="box-none" style={styles.appHeader}>{children}</View>;
}

function NativeObjectContextMenu({
  children,
  items,
  preview,
  style,
}: {
  children: ReactNode;
  items: ReactNode;
  preview?: ReactNode;
  style?: ComponentProps<typeof View>['style'];
}) {
  if (Platform.OS !== 'ios') return <View style={style}>{children}</View>;
  return (
    <SwiftUIHost ignoreSafeArea="all" matchContents style={style}>
      <SwiftUIContextMenu>
        <SwiftUIContextMenu.Trigger>
          <SwiftUIRNHostView matchContents><>{children}</></SwiftUIRNHostView>
        </SwiftUIContextMenu.Trigger>
        {preview && (
          <SwiftUIContextMenu.Preview>
            <SwiftUIRNHostView matchContents><>{preview}</></SwiftUIRNHostView>
          </SwiftUIContextMenu.Preview>
        )}
        <SwiftUIContextMenu.Items>{items}</SwiftUIContextMenu.Items>
      </SwiftUIContextMenu>
    </SwiftUIHost>
  );
}

async function copyText(text: string, announcement = 'Copied') {
  await Clipboard.setStringAsync(text);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  AccessibilityInfo.announceForAccessibility(announcement);
}

function IconAction({ disabled = false, icon, label, onPress }: { disabled?: boolean; icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconAction, disabled && styles.disabledIconAction, pressed && styles.pressed]}
    >
      <Icon name={icon} size={16} color={COLORS.muted} />
    </Pressable>
  );
}

function ModelMark({ model, size = 28, logo = 'model' }: { model: Model; size?: number; logo?: 'model' | 'lab' }) {
  return (
    <Image
      resizeMode="contain"
      source={logo === 'lab' ? model.labIcon ?? model.icon : model.icon}
      style={{ width: size, height: size, tintColor: model.tintColor }}
    />
  );
}

/** Neutral pending state; reasoning is rendered only from reasoning output. */
function ResponsePendingDot({ delay, reduceMotion }: { delay: number; reduceMotion: boolean }) {
  const translateY = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  useEffect(() => {
    cancelAnimation(translateY);
    translateY.value = 0;
    if (reduceMotion) return undefined;

    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-4, { duration: 300 }),
          withTiming(0, { duration: 300 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(translateY);
  }, [delay, reduceMotion, translateY]);

  return <Reanimated.View style={[styles.responsePendingDot, animatedStyle]} />;
}

function ResponsePendingIndicator() {
  const { reduceMotion } = useAccessibilityPreferences();

  return (
    <View
      accessibilityLabel="Assistant is responding"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.responsePending}
    >
      <ResponsePendingDot delay={0} reduceMotion={reduceMotion} />
      <ResponsePendingDot delay={150} reduceMotion={reduceMotion} />
      <ResponsePendingDot delay={300} reduceMotion={reduceMotion} />
    </View>
  );
}

function BlinkingCaret() {
  const { reduceMotion } = useAccessibilityPreferences();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return <Animated.Text style={[styles.caret, { opacity }]}>▍</Animated.Text>;
}

const RootStack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <AppPreferencesProvider>
      <AccessibilityPreferencesProvider>
        <PrototypeRoot />
      </AccessibilityPreferencesProvider>
    </AppPreferencesProvider>
  );
}

function PrototypeRoot() {
  const productionStatus = useSessionStore((state) => state.status);
  const productionUser = useSessionStore((state) => state.user);
  const productionInstanceUrl = useSessionStore((state) => state.instanceUrl);
  const productionConfig = useSessionStore((state) => state.config);
  const expectedNamespace = productionUser?.id ? cacheNamespace(productionInstanceUrl, productionUser.id) : null;
  const status = productionStatus === 'authenticated' ? 'signed-in' : productionStatus === 'pending' ? 'pending' : 'signed-out';
  const appearance = useColorScheme();
  const themePreference = usePrototypeStore((state) => state.preferences.theme);
  const isDark = themePreference === 'dark' || (themePreference === 'system' && appearance !== 'light');
  const navigationTheme = useMemo(() => {
    const base = isDark ? NavigationDarkTheme : NavigationLightTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: isDark ? '#FFFFFF' : '#111114',
        background: isDark ? '#000000' : '#F5F5F7',
        card: isDark ? '#000000' : '#F5F5F7',
        text: isDark ? '#F7F7F8' : '#111114',
        border: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)',
      },
    };
  }, [isDark]);
  useEffect(() => {
    usePrototypeStore.setState((state) => ({
      instance: {
        ...state.instance,
        url: productionInstanceUrl,
        name: productionConfig?.instance.name ?? state.instance.name,
        version: productionConfig?.instance.version ?? state.instance.version,
        signupOpen: productionConfig?.auth.signupEnabled ?? state.instance.signupOpen,
      },
      session: {
        status: productionStatus === 'authenticated' ? 'signed-in' : productionStatus === 'pending' ? 'pending' : 'signed-out',
        user: productionUser ? {
          id: productionUser.id,
          name: productionUser.name,
          email: productionUser.email,
          role: productionUser.role === 'pending' ? 'pending' : 'member',
          initials: productionUser.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?',
        } : null,
      },
    }));
  }, [productionConfig, productionInstanceUrl, productionStatus, productionUser]);
  useLayoutEffect(() => {
    if (productionStatus !== 'authenticated' || !expectedNamespace) {
      if (usePrototypeStore.getState().productionNamespace !== null) clearProductionScope();
      void usePreferencesStore.getState().activateAgentNamespace(null);
      return;
    }
    if (usePrototypeStore.getState().productionNamespace !== expectedNamespace) {
      void hydrateProductionScope(expectedNamespace);
    }
  }, [expectedNamespace, productionStatus]);
  if (productionStatus === 'hydrating') return null;
  if (status !== 'signed-in') return <AuthExperience />;
  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator
        initialRouteName="Chat"
        screenOptions={{ animation: 'default', contentStyle: { backgroundColor: isDark ? '#000000' : '#F5F5F7' }, headerShown: false, headerShadowVisible: false }}
      >
        <RootStack.Screen name="Chat" component={AppContent} />
        <RootStack.Screen name="Settings" component={MemberSettingsScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Settings' }} />
        <RootStack.Screen name="Account" component={AccountScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Account', headerBackTitle: 'Settings' }} />
        <RootStack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: Platform.OS === 'ios', presentation: 'formSheet', title: 'Edit Profile' }} />
        <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Change Password', headerBackTitle: 'Account' }} />
        <RootStack.Screen name="TwoFactor" component={TwoFactorScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="InstanceDetails" component={InstanceDetailsScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Pulpo Instance', headerBackTitle: 'Account' }} />
        <RootStack.Screen name="SettingsDetail" component={SettingsDetailScreen} options={{ headerShown: Platform.OS === 'ios', headerBackTitle: 'Settings' }} />
        <RootStack.Screen name="Trash" component={TrashScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Trash', headerBackTitle: 'Settings' }} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

function AppContent({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Chat'>) {
  const queryClient = useQueryClient();
  const productionInstanceUrl = useSessionStore((state) => state.instanceUrl);
  const productionUserId = useSessionStore((state) => state.user?.id);
  const { width } = useWindowDimensions();
  const isDark = useColorScheme() === 'dark';
  const { reduceMotion } = useAccessibilityPreferences();
  const persistentSidebar = usesPersistentSidebar(width);
  const drawerWidth = Math.min(Math.max(width - DRAWER_TRAILING_PEEK, 0), DRAWER_MAX_WIDTH);
  const openOffset = drawerWidth;

  const slideX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const storedChats = usePrototypeStore((state) => state.chats);
  const defaultModelId = usePrototypeStore((state) => state.defaultModelId);
  const productionScopeReady = usePrototypeStore((state) => state.productionScopeReady);
  const modelCatalogReady = usePrototypeStore((state) => state.modelCatalogReady);
  const upsertChat = usePrototypeStore((state) => state.upsertChat);
  const discardStoredChat = usePrototypeStore((state) => state.discardChat);
  const appendStoredMessage = usePrototypeStore((state) => state.appendMessage);
  const updateStoredMessage = usePrototypeStore((state) => state.updateMessage);
  const prototypeModels = usePrototypeStore((state) => state.models);
  const agentAvailable = usePrototypeStore((state) => state.agentAvailable);
  const availableModels = useMemo(() => prototypeModels.map((model) => prototypeModelToLegacy(model, isDark)), [isDark, prototypeModels]);
  const [selectedModelId, setSelectedModelId] = useState(() => defaultModelId || prototypeModels[0]?.id || '');
  const selectedPrototypeModel = useMemo(
    () => prototypeModels.find((model) => model.id === selectedModelId) ?? prototypeModels[0],
    [prototypeModels, selectedModelId],
  );
  const selectedModel = useMemo(
    () => availableModels.find((model) => model.id === selectedModelId)
      ?? availableModels[0]
      ?? (modelCatalogReady ? UNAVAILABLE_MODEL : LOADING_MODEL),
    [availableModels, modelCatalogReady, selectedModelId],
  );
  const generationPreferences = usePreferencesStore((state) => state.generation);
  const presetSelections = useMemo(
    () => resolveGenerationSelections(selectedPrototypeModel, generationPreferences[selectedModel.id]),
    [generationPreferences, selectedModel.id, selectedPrototypeModel],
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [newChatTemporary, setNewChatTemporary] = useState(false);
  const [savingTemporaryChatId, setSavingTemporaryChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [assistantStatus, setAssistantStatus] = useState<'idle' | 'thinking' | 'streaming'>('idle');
  const [streamingSession, setStreamingSession] = useState<StreamingSession | null>(null);
  const thinkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeResponseId = useRef<string | null>(null);
  const activeResponseSubscription = useRef<(() => void) | null>(null);
  const previousHistoryChats = useRef<HistoryChatSummary[]>([]);
  const pendingTemporaryStart = useRef<{
    chatId: string;
    promise: ReturnType<typeof startServerChat>;
  } | null>(null);

  const trackActiveResponse = useCallback((response: { responseId: string; status: string; sequence: number }) => {
    activeResponseSubscription.current?.();
    activeResponseSubscription.current = null;
    const active = response.status === 'queued' || response.status === 'in_progress';
    activeResponseId.current = active ? response.responseId : null;
    if (active) activeResponseSubscription.current = subscribeToResponse(response.responseId, response.sequence);
    return active;
  }, []);

  useEffect(() => {
    if (!persistentSidebar) return;
    setPanelOpen(false);
    slideX.value = 0;
  }, [persistentSidebar, slideX]);

  useEffect(() => {
    if (prototypeModels.some((model) => model.id === selectedModelId)) return;
    setSelectedModelId(defaultModelId || prototypeModels[0]?.id || '');
  }, [defaultModelId, prototypeModels, selectedModelId]);

  useEffect(() => useRealtimeStore.subscribe((state) => {
    const responseId = activeResponseId.current;
    if (!responseId) return;
    const status = state.snapshots[responseId]?.status;
    if (!status || status === 'queued' || status === 'in_progress') return;
    activeResponseId.current = null;
    activeResponseSubscription.current?.();
    activeResponseSubscription.current = null;
    setAssistantStatus('idle');
    AccessibilityInfo.announceForAccessibility(status === 'completed' ? 'Response complete' : 'Response stopped');
    if (status === 'completed') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }), []);

  useEffect(() => {
    return () => {
      if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
      activeResponseSubscription.current?.();
      activeResponseSubscription.current = null;
    };
  }, []);

  useEffect(() => {
    const requestedChatId = route.params?.chatId;
    if (!requestedChatId || !storedChats.some((chat) => chat.id === requestedChatId && chat.deletedAt === null)) return;
    setActiveChatId(requestedChatId);
    const requestedChat = storedChats.find((chat) => chat.id === requestedChatId);
    if (requestedChat?.modelId) setSelectedModelId(requestedChat.modelId);
    setAssistantStatus('idle');
    setStreamingSession(null);
    navigation.setParams({ chatId: undefined });
  }, [navigation, route.params?.chatId, storedChats]);

  const animatePanel = useCallback((open: boolean, velocity = 0) => {
    if (persistentSidebar) return;
    setPanelOpen(open);
    if (open) Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const target = open ? openOffset : 0;
    slideX.value = reduceMotion ? target : withSpring(target, {
      velocity,
      damping: 26,
      stiffness: 240,
      mass: 0.9,
      overshootClamping: true,
    });
  }, [openOffset, persistentSidebar, reduceMotion, slideX]);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const finishPanelGesture = useCallback((open: boolean) => {
    setPanelOpen(open);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const settlePanelGesture = useCallback((velocityX: number) => {
    'worklet';
    const open = velocityX > 500
      ? true
      : velocityX < -500
        ? false
        : slideX.value > openOffset * 0.45;
    const target = open ? openOffset : 0;
    slideX.value = reduceMotion ? target : withSpring(target, {
      velocity: velocityX,
      damping: 26,
      stiffness: 240,
      mass: 0.9,
      overshootClamping: true,
    });
    runOnJS(finishPanelGesture)(open);
  }, [finishPanelGesture, openOffset, reduceMotion, slideX]);

  const openPanelGesture = useMemo(() => Gesture.Pan()
    .enabled(!persistentSidebar && !panelOpen)
    .activeOffsetX(10)
    .failOffsetY([-12, 12])
    .onStart(() => {
      gestureStartX.value = slideX.value;
      runOnJS(dismissKeyboard)();
    })
    .onUpdate((event) => {
      slideX.value = Math.max(0, Math.min(openOffset, gestureStartX.value + event.translationX));
    })
    .onEnd((event) => settlePanelGesture(event.velocityX)), [
      dismissKeyboard,
      gestureStartX,
      openOffset,
      panelOpen,
      persistentSidebar,
      settlePanelGesture,
      slideX,
    ]);

  const closePanelGesture = useMemo(() => Gesture.Pan()
    .enabled(!persistentSidebar && panelOpen)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onStart(() => {
      gestureStartX.value = slideX.value;
    })
    .onUpdate((event) => {
      slideX.value = Math.max(0, Math.min(openOffset, gestureStartX.value + event.translationX));
    })
    .onEnd((event) => settlePanelGesture(event.velocityX)), [
      gestureStartX,
      openOffset,
      panelOpen,
      persistentSidebar,
      settlePanelGesture,
      slideX,
    ]);

  const panelGesture = useMemo(
    () => Gesture.Simultaneous(openPanelGesture, closePanelGesture),
    [closePanelGesture, openPanelGesture],
  );

  const mainAnimatedStyle = useAnimatedStyle(() => {
    if (persistentSidebar) {
      return { transform: [{ translateX: 0 }, { scale: 1 }] };
    }
    const progress = openOffset > 0 ? slideX.value / openOffset : 0;
    return {
      transform: [
        { translateX: slideX.value },
        { scale: reduceMotion ? 1 : interpolate(progress, [0, 1], [1, 0.965]) },
      ],
    };
  }, [openOffset, persistentSidebar, reduceMotion]);
  const panelAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: persistentSidebar || reduceMotion ? 0 : interpolate(slideX.value, [0, openOffset], [-36, 0]) }],
  }), [openOffset, persistentSidebar, reduceMotion]);
  const historyChats = useMemo(() => {
    const now = Date.now();
    const projected = visibleHistoryChats(storedChats).map((chat) => historyChatSummary(chat, now));
    return reuseHistoryChatSummaries(previousHistoryChats.current, projected);
  }, [storedChats]);
  useEffect(() => {
    previousHistoryChats.current = historyChats;
  }, [historyChats]);
  const activePrototypeChat = useMemo(() => storedChats.find((chat) => chat.id === activeChatId && chat.deletedAt === null) ?? null, [activeChatId, storedChats]);
  const activeChat = useMemo(() => activePrototypeChat ? prototypeChatToLegacy(activePrototypeChat) : null, [activePrototypeChat]);
  const messages = activeChat?.messages ?? [];
  const remoteAssistantStatus = messages.some((message) => message.role === 'assistant' && message.status === 'streaming')
    ? 'streaming'
    : messages.some((message) => message.role === 'assistant' && message.status === 'queued')
      ? 'thinking'
      : 'idle';
  const effectiveAssistantStatus = assistantStatus === 'idle' ? remoteAssistantStatus : assistantStatus;

  const abandonActiveTemporaryChat = useCallback(() => {
    if (!activeChatId) return;
    const chat = usePrototypeStore.getState().chats.find((candidate) => candidate.id === activeChatId);
    if (!chat?.temporary) return;
    discardStoredChat(chat.id);
    if (!productionUserId) return;
    const namespace = cacheNamespace(productionInstanceUrl, productionUserId);
    discardOptimisticChat(namespace, chat.id);
    queryClient.removeQueries({ queryKey: queryKeys.chat(namespace, chat.id), exact: true });
    for (const message of chat.messages) {
      if (message.role !== 'assistant') continue;
      useRealtimeStore.getState().removeSnapshot(message.id);
      void deleteResponseCursor(namespace, message.id);
    }
  }, [activeChatId, discardStoredChat, productionInstanceUrl, productionUserId, queryClient]);

  const selectChat = useCallback((chat: HistoryChatSummary) => {
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = null;
    abandonActiveTemporaryChat();
    setActiveChatId(chat.id);
    setSelectedModelId(chat.modelId);
    setAssistantStatus('idle');
    setStreamingSession(null);
    animatePanel(false);
  }, [abandonActiveTemporaryChat, animatePanel]);

  const newChat = useCallback((temporaryByDefault = false) => {
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = null;
    abandonActiveTemporaryChat();
    setAssistantStatus('idle');
    setStreamingSession(null);
    setActiveChatId(null);
    setNewChatTemporary(temporaryByDefault);
    setSelectedModelId(defaultModelId || prototypeModels[0]?.id || '');
    setInput('');
  }, [abandonActiveTemporaryChat, defaultModelId, prototypeModels]);

  const newChatFromHistory = useCallback(() => {
    newChat();
    animatePanel(false);
  }, [animatePanel, newChat]);

  const openSettingsFromHistory = useCallback(() => {
    abandonActiveTemporaryChat();
    Keyboard.dismiss();
    navigation.navigate('Settings');
  }, [abandonActiveTemporaryChat, navigation]);

  const saveActiveTemporaryChat = useCallback(async () => {
    if (!activeChatId || savingTemporaryChatId) return;
    const chat = usePrototypeStore.getState().chats.find((candidate) => candidate.id === activeChatId);
    if (!chat?.temporary) return;
    if (chat.expired) {
      Alert.alert('Temporary chat expired', 'This conversation can no longer be saved.');
      return;
    }
    setSavingTemporaryChatId(activeChatId);
    try {
      const pending = pendingTemporaryStart.current;
      if (pending?.chatId === activeChatId) await pending.promise;
      const persisted = await persistServerChat(activeChatId);
      usePrototypeStore.setState((state) => ({
        chats: state.chats.map((candidate) => candidate.id === activeChatId
          ? { ...candidate, temporary: false, expiresAt: null, expired: false }
          : candidate),
      }));
      setNewChatTemporary(false);
      if (productionUserId) {
        const namespace = cacheNamespace(productionInstanceUrl, productionUserId);
        queryClient.setQueryData<ServerChat>(queryKeys.chat(namespace, activeChatId), (current) => current
          ? {
            ...current,
            ...persisted,
            temporary: false,
            expiresAt: null,
            responses: current.responses,
            attachments: current.attachments,
          }
          : { ...persisted, temporary: false, expiresAt: null });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, activeChatId) }),
        ]);
      }
      AccessibilityInfo.announceForAccessibility('Chat saved to history');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'temporary_chat_expired' || error.status === 404)) {
        usePrototypeStore.setState((state) => ({
          chats: state.chats.map((candidate) => candidate.id === activeChatId
            ? { ...candidate, expired: true }
            : candidate),
        }));
      }
      Alert.alert('Couldn’t save chat', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingTemporaryChatId((current) => current === activeChatId ? null : current);
    }
  }, [activeChatId, productionInstanceUrl, productionUserId, queryClient, savingTemporaryChatId]);

  const selectModel = useCallback((model: Model) => {
    setSelectedModelId(model.id);
    Haptics.selectionAsync();
  }, []);

  const selectPreset = useCallback((presetId: string, choiceId: string) => {
    const store = usePreferencesStore.getState();
    const generation = store.generation;
    const next = {
      ...generation,
      [selectedModelId]: { ...generation[selectedModelId], [presetId]: choiceId },
    };
    runProductionAction(productionActions.setPreference('generation', next), {
      onError: (error) => {
        useRealtimeStore.getState().setSyncError(error instanceof Error ? error.message : 'The preset choice could not be synced.');
      },
    });
    Haptics.selectionAsync();
  }, [selectedModelId]);

  const sendMessage = async (value = input, attachments: PreparedAttachment[] = [], options?: SendOptions): Promise<boolean> => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || effectiveAssistantStatus !== 'idle' || !selectedModel.id) return false;
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    const timestamp = Date.now();
    const key = activeChat?.id ?? Crypto.randomUUID();
    const responseId = Crypto.randomUUID();
    const inputMessageId = `${responseId}:input`;
    const modelId = selectedModel.id;
    const parentResponseId = activePrototypeChat?.messages.filter((message) => message.role === 'assistant').at(-1)?.id ?? null;
    const agentMode = Boolean(options?.agentEnabled && agentAvailable && selectedPrototypeModel?.agentEnabled);
    const selections = options?.presetSelections ?? presetSelections;
    const title = trimmed ? trimmed.split(/\s+/).slice(0, 7).join(' ') : attachments[0]?.name ?? 'Attachment chat';
    const productionNamespace = productionUserId ? cacheNamespace(productionInstanceUrl, productionUserId) : null;
    if (!activeChat) {
      upsertChat({
        id: key,
        title,
        modelId,
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
        folderId: null,
        temporary: options?.temporary ?? false,
        deletedAt: null,
        purgeAt: null,
        messages: [],
      });
      setActiveChatId(key);
    }
    appendStoredMessage(key, {
      id: inputMessageId,
      role: 'user',
      text: trimmed,
      createdAt: timestamp,
      status: 'complete',
      attachments: attachments.map((attachment) => ({
        id: attachment.serverId, name: attachment.name, uri: attachment.uri, mimeType: attachment.mimeType,
        sizeBytes: attachment.size ?? 0, kind: attachment.kind, status: 'ready',
      })),
    });
    // Create the final response row up front. Realtime projection reuses this
    // id, so its authoritative model header never swaps from a footer into a
    // different component when the server acknowledges the request.
    appendStoredMessage(key, {
      id: responseId,
      role: 'assistant',
      text: '',
      createdAt: timestamp + 1,
      modelId,
      status: 'queued',
      outputItems: [],
      agentMode,
    });
    if (productionNamespace) {
      cacheOptimisticTurn({
        queryClient,
        namespace: productionNamespace,
        chatId: key,
        responseId,
        parentResponseId,
        content: trimmed,
        title,
        modelId,
        temporary: options?.temporary ?? false,
        presetSelections: selections,
        agentMode,
        attachments: attachments.map((attachment) => ({
          id: attachment.serverId,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size ?? 0,
        })),
        createdAt: timestamp,
      });
    }
    activeResponseId.current = responseId;
    setAssistantStatus('thinking');
    setStreamingSession(null);
    let serverChatCreated = Boolean(activeChat);
    try {
      let serverChatId = activeChat?.id;
      let response: Awaited<ReturnType<typeof sendServerMessage>>;
      if (!serverChatId) {
        const startPromise = startServerChat({
          chatId: key,
          responseId,
          content: trimmed,
          modelId,
          temporary: options?.temporary ?? false,
          title,
          presetSelections: selections,
          attachmentIds: attachments.map((attachment) => attachment.serverId),
          agentMode,
        });
        if (options?.temporary) pendingTemporaryStart.current = { chatId: key, promise: startPromise };
        let started: Awaited<typeof startPromise>;
        try {
          started = await startPromise;
        } finally {
          if (pendingTemporaryStart.current?.promise === startPromise) pendingTemporaryStart.current = null;
        }
        serverChatId = started.chat.id;
        response = started.response;
        serverChatCreated = true;
        setActiveChatId(serverChatId);
      } else {
        response = await sendServerMessage({
          clientId: responseId,
          chatId: serverChatId,
          content: trimmed,
          modelId,
          parentResponseId,
          presetSelections: selections,
          attachmentIds: attachments.map((attachment) => attachment.serverId),
          agentMode,
          temporary: activePrototypeChat?.temporary ?? false,
        });
      }
      updateStoredMessage(serverChatId, response.responseId, {
        modelId,
        status: response.status === 'completed' ? 'complete'
          : response.status === 'failed' ? 'failed'
            : response.status === 'cancelled' || response.status === 'incomplete' ? 'stopped'
              : response.status === 'queued' ? 'queued' : 'streaming',
        outputItems: response.output,
        error: response.error && typeof response.error === 'object' && 'message' in response.error
          ? String((response.error as { message?: unknown }).message ?? '')
          : undefined,
      });
      const responseActive = trackActiveResponse(response);
      setAssistantStatus(responseActive ? 'streaming' : 'idle');
      if (productionNamespace) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chats(productionNamespace) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(productionNamespace, serverChatId) });
      }
      return true;
    } catch (error) {
      activeResponseId.current = null;
      activeResponseSubscription.current?.();
      activeResponseSubscription.current = null;
      setAssistantStatus('idle');
      if (productionNamespace) {
        rejectOptimisticTurn({
          queryClient,
          namespace: productionNamespace,
          responseId,
          discardChat: !activeChat && !serverChatCreated,
        });
      }
      usePrototypeStore.setState((state) => ({
        chats: activeChat || serverChatCreated
          ? state.chats.map((chat) => chat.id === key
            ? {
              ...chat,
              expired: chat.temporary && error instanceof ApiError
                && (error.code === 'temporary_chat_expired' || error.status === 404)
                ? true
                : chat.expired,
              messages: chat.messages.filter((message) => message.id !== inputMessageId && message.id !== responseId),
            }
            : chat)
          : state.chats.filter((chat) => chat.id !== key),
      }));
      if (!activeChat && !serverChatCreated) setActiveChatId((current) => current === key ? null : current);
      throw error;
    }
  };

  const completeStreamingResponse = useCallback((session: StreamingSession) => {
    const words = session.response.split(' ');
    const tokensIn = 480 + Math.floor(Math.random() * 900);
    const tokensOut = words.length + 90;
    const seconds = (3 + Math.random() * 6).toFixed(1);
    const timestamp = Date.now();
    const responseModel = usePrototypeStore.getState().models.find((model) => model.id === session.modelId);
    const scenario = usePrototypeStore.getState().demo.response;
    const activity: ActivityStep[] = scenario === 'tool-heavy' ? [
      { id: `reasoning-${timestamp}`, kind: 'reasoning', title: 'Planned the implementation', detail: REASONING_SAMPLE, durationMs: session.thinkSeconds * 1000, status: 'complete' },
      { id: `tool-search-${timestamp}`, kind: 'tool', title: 'Searched the workspace', detail: 'Located chat state, navigation, and settings components.', output: '18 files searched · 7 matches', durationMs: 1700, status: 'complete' },
      { id: `tool-patch-${timestamp}`, kind: 'tool', title: 'Applied changes', detail: 'Updated the member prototype and verified the resulting state.', output: '3 files changed · typecheck passed', durationMs: 2600, status: 'complete' },
      { id: `workspace-${timestamp}`, kind: 'workspace', title: 'Finished in agent workspace', detail: 'Workspace released cleanly.', durationMs: 1200, status: 'complete' },
    ] : scenario === 'capacity' ? [
      { id: `reasoning-${timestamp}`, kind: 'reasoning', title: 'Prepared the coding task', detail: REASONING_SAMPLE, durationMs: session.thinkSeconds * 1000, status: 'complete' },
      { id: `workspace-${timestamp}`, kind: 'workspace', title: 'Agent workspace unavailable', detail: 'All workspace capacity is currently in use.', durationMs: 8400, status: 'failed' },
    ] : [{ id: `reasoning-${timestamp}`, kind: 'reasoning', title: 'Reasoned about the request', detail: REASONING_SAMPLE, durationMs: session.thinkSeconds * 1000, status: 'complete' }];
    appendStoredMessage(session.chatKey, {
      id: `a${timestamp}`,
      role: 'assistant',
      modelId: responseModel?.id ?? session.modelId,
      text: scenario === 'failure' ? '' : session.response,
      createdAt: timestamp,
      status: scenario === 'failure' ? 'failed' : 'complete',
      error: scenario === 'failure' ? 'Pulpo lost the upstream connection before the response completed. Retry when your connection is stable.' : undefined,
      activity,
      meta: `${tokensIn.toLocaleString()}→${tokensOut} tok · ${Math.round(tokensOut / Number(seconds))} tok/s · ${seconds}s`,
      feedback: null,
    });
    setStreamingSession((current) => current?.id === session.id ? null : current);
    setAssistantStatus('idle');
    AccessibilityInfo.announceForAccessibility('Response complete');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [appendStoredMessage]);

  const regenerateMessage = useCallback((message: Message) => {
    const chatId = message.chatId ?? activeChatId;
    if (!chatId || !productionUserId || effectiveAssistantStatus !== 'idle') return;
    const modelId = selectedModel.id;
    const selections = { ...presetSelections };
    const namespace = cacheNamespace(productionInstanceUrl, productionUserId);
    const responseId = Crypto.randomUUID();
    const optimistic = cacheOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      sourceResponseId: message.id,
      responseId,
      modelId,
      presetSelections: selections,
      createdAt: Date.now(),
    });
    setAssistantStatus('thinking');
    if (optimistic) trackActiveResponse(optimistic.snapshot);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    void regenerateServerResponse(message.id, modelId, selections, responseId).then((response) => {
      const responseActive = trackActiveResponse(response);
      setAssistantStatus(responseActive ? (response.status === 'queued' ? 'thinking' : 'streaming') : 'idle');
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) });
    }).catch((error) => {
      activeResponseId.current = null;
      activeResponseSubscription.current?.();
      activeResponseSubscription.current = null;
      rejectOptimisticTurn({ queryClient, namespace, responseId, discardChat: false });
      setAssistantStatus('idle');
      Alert.alert('Couldn’t regenerate response', error instanceof Error ? error.message : undefined);
    });
  }, [activeChatId, effectiveAssistantStatus, presetSelections, productionInstanceUrl, productionUserId, queryClient, selectedModel.id, trackActiveResponse]);

  const editMessage = useCallback(async (
    message: Message,
    content: string,
    attachments: PreparedAttachment[] = [],
    agentMode = Boolean(message.agentMode),
  ): Promise<boolean> => {
    const chatId = message.chatId ?? activeChatId;
    if (!chatId || !productionUserId || effectiveAssistantStatus !== 'idle') return false;
    const modelId = selectedModel.id;
    const selections = { ...presetSelections };
    const namespace = cacheNamespace(productionInstanceUrl, productionUserId);
    const responseId = Crypto.randomUUID();
    const sourceResponseId = message.id.endsWith(':input') ? message.id.slice(0, -6) : message.id;
    const optimistic = cacheOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      sourceResponseId,
      responseId,
      modelId,
      presetSelections: selections,
      ...(message.role === 'user' ? { editedInput: content } : { editedOutput: content }),
      ...(message.role === 'user' ? {
        editedAttachments: attachments.map((attachment) => ({
          id: attachment.serverId,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size ?? 0,
        })),
        editedAgentMode: agentMode,
      } : {}),
      createdAt: Date.now(),
    });
    if (message.role === 'user') {
      setAssistantStatus('thinking');
      if (optimistic) trackActiveResponse(optimistic.snapshot);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    try {
      const response = await editServerMessage({
        id: message.id,
        content,
        modelId,
        presetSelections: selections,
        attachmentIds: message.role === 'user' ? attachments.map((attachment) => attachment.serverId) : undefined,
        agentMode: message.role === 'user' ? agentMode : undefined,
        clientId: responseId,
      });
      const responseActive = trackActiveResponse(response);
      setAssistantStatus(responseActive ? (response.status === 'queued' ? 'thinking' : 'streaming') : 'idle');
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, chatId) });
      return true;
    } catch (error) {
      activeResponseId.current = null;
      activeResponseSubscription.current?.();
      activeResponseSubscription.current = null;
      rejectOptimisticTurn({ queryClient, namespace, responseId, discardChat: false });
      setAssistantStatus('idle');
      Alert.alert(message.role === 'user' ? 'Couldn’t edit message' : 'Couldn’t edit response', error instanceof Error ? error.message : undefined);
      return false;
    }
  }, [activeChatId, effectiveAssistantStatus, presetSelections, productionInstanceUrl, productionUserId, queryClient, selectedModel.id, trackActiveResponse]);

  const activateMessageBranch = useCallback(async (message: Message, branchId: string) => {
    const chatId = message.chatId ?? activeChatId;
    if (!chatId || !productionUserId) throw new Error('This branch is not available yet.');
    const namespace = cacheNamespace(productionInstanceUrl, productionUserId);
    await activateOptimisticBranch({
      queryClient,
      namespace,
      chatId,
      selectedResponseId: branchId,
      request: activateServerBranch,
    });
  }, [activeChatId, productionInstanceUrl, productionUserId, queryClient]);

  const stopGeneration = useCallback(() => {
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = null;
    setStreamingSession(null);
    setAssistantStatus('idle');
    const responseId = activeResponseId.current;
    activeResponseSubscription.current?.();
    activeResponseSubscription.current = null;
    if (responseId) {
      const store = usePrototypeStore.getState();
      const chat = store.chats.find((candidate) => candidate.messages.some((message) => message.id === responseId));
      if (chat) store.updateMessage(chat.id, responseId, { status: 'stopped' });
      void cancelResponse(responseId).catch(() => undefined).finally(() => {
        if (activeResponseId.current === responseId) activeResponseId.current = null;
      });
    }
    AccessibilityInfo.announceForAccessibility('Response stopped');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <GestureDetector gesture={panelGesture}>
      <View style={styles.root}>
        <ProductionBridge activeChatId={activeChatId} />
        <StatusBar style="auto" />

        {/* History page, revealed underneath as the chat view slides right */}
        <Reanimated.View
          accessibilityElementsHidden={!persistentSidebar && !panelOpen}
          importantForAccessibility={!persistentSidebar && !panelOpen ? 'no-hide-descendants' : 'auto'}
          style={persistentSidebar
            ? [styles.persistentPanel, panelAnimatedStyle]
            : [styles.drawerPanel, { width: drawerWidth }, panelAnimatedStyle]}
        >
          <HistoryPanel
            chats={historyChats}
            activeChatId={activeChatId}
            drawerOpen={panelOpen}
            loading={!productionScopeReady}
            persistent={persistentSidebar}
            onSelectChat={selectChat}
            onNewChat={newChatFromHistory}
            onOpenSettings={openSettingsFromHistory}
          />
        </Reanimated.View>

        {/* Main chat view sliding over to the right */}
        <Reanimated.View
          accessibilityElementsHidden={!persistentSidebar && panelOpen}
          importantForAccessibility={!persistentSidebar && panelOpen ? 'no-hide-descendants' : 'auto'}
          style={[persistentSidebar ? styles.persistentMainView : styles.mainView, mainAnimatedStyle]}
        >
          <ChatView
            messages={messages}
            chatId={activeChat?.id ?? null}
            chatLoaded={activePrototypeChat?.detailLoaded !== false}
            keyboardLayoutEnabled={!panelOpen}
            model={selectedModel}
            models={availableModels}
            prototypeModel={selectedPrototypeModel}
            presetSelections={presetSelections}
            input={input}
            onChangeInput={setInput}
            onSelectPreset={selectPreset}
            onSend={sendMessage}
            onStop={stopGeneration}
            assistantStatus={effectiveAssistantStatus}
            streamingSession={streamingSession}
            onStreamingComplete={completeStreamingResponse}
            onRegenerate={regenerateMessage}
            onEdit={editMessage}
            onActivateBranch={activateMessageBranch}
            onOpenPanel={() => animatePanel(true)}
            persistentSidebar={persistentSidebar}
            onOpenModelPicker={() => { Haptics.selectionAsync(); setModelSheet(true); }}
            onSelectModel={selectModel}
            temporary={activePrototypeChat?.temporary ?? newChatTemporary}
            expired={Boolean(activePrototypeChat?.expired)}
            savingTemporary={savingTemporaryChatId === activePrototypeChat?.id}
            onTemporaryChange={setNewChatTemporary}
            onSaveTemporary={() => { void saveActiveTemporaryChat(); }}
            onNewChat={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              newChat(nextChatStartsTemporary(Boolean(activePrototypeChat?.temporary)));
            }}
          />
          {/* Tap catcher while the panel is open */}
          {!persistentSidebar && panelOpen && (
            <Pressable accessibilityLabel="Close chats" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => animatePanel(false)} />
          )}
        </Reanimated.View>

        <ModelSheet
          models={availableModels}
          visible={modelSheet}
          selected={selectedModel.id}
          onClose={() => setModelSheet(false)}
          onSelect={(model) => {
            selectModel(model);
            setModelSheet(false);
          }}
        />
      </View>
    </GestureDetector>
  );
}

type MessageAction = 'copy' | 'share' | 'reply' | 'edit' | 'regenerate' | 'delete';

function useMessageActionRunner({ message, onEdit, onRegenerate }: {
  message: Message;
  onEdit: (message: Message, content: string) => void;
  onRegenerate: (message: Message) => void;
}) {
  const queryClient = useQueryClient();
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const userId = useSessionStore((state) => state.user?.id);
  const refresh = useCallback(() => {
    if (!message.chatId || !userId) return;
    const namespace = cacheNamespace(instanceUrl, userId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, message.chatId) });
  }, [instanceUrl, message.chatId, queryClient, userId]);

  return useCallback((action: MessageAction) => {
    if (action === 'copy') {
      void copyText(message.text, 'Message copied');
      return;
    }
    if (action === 'share') {
      void Share.share({ message: message.text });
      return;
    }
    if (action === 'delete') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      const explanation = message.role === 'user'
        ? 'This removes the message and every response that follows from it. This cannot be undone.'
        : 'This removes this response branch and all of its descendants. This cannot be undone.';
      Alert.alert(message.role === 'user' ? 'Delete message?' : 'Delete response?', explanation, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          if (!message.chatId) return;
          void deleteServerMessage(message.id)
            .then(() => {
              if (userId) applyConfirmedMessageDeletion({
                queryClient,
                namespace: cacheNamespace(instanceUrl, userId),
                chatId: message.chatId!,
                messageId: message.id,
              });
              refresh();
            })
            .catch((error) => Alert.alert('Couldn’t delete message', error instanceof Error ? error.message : undefined));
        } },
      ]);
      return;
    }
    if (action === 'edit') {
      const chatId = message.chatId;
      if (!chatId) return;
      if (message.role === 'user') {
        onEdit(message, message.text);
        return;
      }
      if (Platform.OS === 'ios') {
        Alert.prompt('Edit response', 'Saving creates a response branch.', (text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          onEdit(message, trimmed);
        }, 'plain-text', message.text);
      }
      return;
    }
    if (action === 'regenerate') {
      onRegenerate(message);
      return;
    }
    if (action === 'reply') {
      void copyText(`> ${message.text.split('\n')[0]}\n\n`, 'Reply quote copied');
      return;
    }
    Haptics.selectionAsync();
    const labels = {
      reply: 'Reply to message',
      edit: 'Edit message',
      regenerate: 'Regenerate response',
    } as const;
    Alert.alert(labels[action], message.text.slice(0, 120));
  }, [instanceUrl, message, onEdit, onRegenerate, queryClient, refresh, userId]);
}

function MessageContextMenu({
  message,
  onEdit,
  onRegenerate,
  children,
}: {
  message: Message;
  onEdit: (message: Message, content: string) => void;
  onRegenerate: (message: Message) => void;
  children: ReactNode;
}) {
  const runAction = useMessageActionRunner({ message, onEdit, onRegenerate });

  return (
    <NativeObjectContextMenu
      style={message.role === 'user' ? styles.userMessageContextHost : styles.assistantMessageContextHost}
      preview={(
        <View style={[styles.messageContextPreview, message.role === 'user' && styles.messageContextPreviewUser]}>
          <Text style={styles.messageContextPreviewRole}>{message.role === 'user' ? 'YOU' : 'ASSISTANT'}</Text>
          <Text numberOfLines={8} style={styles.messageContextPreviewText}>{message.text}</Text>
        </View>
      )}
      items={(
        <>
          <SwiftUIControlGroup>
            <SwiftUIButton label="Copy" systemImage="doc.on.doc" onPress={() => runAction('copy')} />
            <SwiftUIButton label="Share" systemImage="square.and.arrow.up" onPress={() => runAction('share')} />
            <SwiftUIButton label="Reply" systemImage="arrowshape.turn.up.left" onPress={() => runAction('reply')} />
          </SwiftUIControlGroup>
          <SwiftUIDivider />
          {message.role === 'user'
            ? <SwiftUIButton label="Edit message" systemImage="pencil" onPress={() => runAction('edit')} />
            : <>
              <SwiftUIButton label="Edit response" systemImage="pencil" onPress={() => runAction('edit')} />
              <SwiftUIButton label="Regenerate response" systemImage="arrow.clockwise" onPress={() => runAction('regenerate')} />
            </>}
          <SwiftUIButton label="Delete message" role="destructive" systemImage="trash" onPress={() => runAction('delete')} />
        </>
      )}
    >
      {children}
    </NativeObjectContextMenu>
  );
}

function SentAttachmentContextMenu({ attachment, message, onEdit, onRegenerate, children }: {
  attachment: Attachment;
  message: Message;
  onEdit: (message: Message, content: string) => void;
  onRegenerate: (message: Message) => void;
  children: ReactNode;
}) {
  const runMessageAction = useMessageActionRunner({ message, onEdit, onRegenerate });
  const shareAttachment = () => {
    if (attachment.uri) void Share.share({ message: attachment.name, url: attachment.uri });
    else void shareServerAttachment(attachment.id, attachment.name, attachment.mimeType).catch((error) => Alert.alert('Couldn’t share attachment', error instanceof Error ? error.message : undefined));
  };
  const saveAttachment = () => {
    if (attachment.uri) void Share.share({ message: attachment.name, url: attachment.uri });
    else void downloadAttachment(attachment.id, attachment.name).then(() => AccessibilityInfo.announceForAccessibility('Attachment saved')).catch((error) => Alert.alert('Couldn’t save attachment', error instanceof Error ? error.message : undefined));
  };
  const copyAttachment = () => {
    void (async () => {
      const uri = attachment.uri || (await downloadAttachment(attachment.id, attachment.name)).uri;
      await copyFile(uri);
      AccessibilityInfo.announceForAccessibility('File copied');
    })().catch((error) => Alert.alert('Couldn’t copy file', error instanceof Error ? error.message : undefined));
  };
  return (
    <NativeObjectContextMenu
      style={attachment.kind === 'image' ? styles.sentImageContextHost : styles.sentFileContextHost}
      preview={attachment.kind === 'image' ? (
        <ResolvedAttachmentImage attachment={attachment} variant="preview" />
      ) : (
        <View style={styles.attachmentContextFilePreview}>
          <Icon name="doc.fill" size={38} color={COLORS.muted} />
          <Text numberOfLines={2} style={styles.attachmentContextFileName}>{attachment.name}</Text>
          <Text style={styles.attachmentContextFileMeta}>{formatAttachmentSize(attachment.size)}</Text>
        </View>
      )}
      items={(
        <>
          <SwiftUIControlGroup>
            <SwiftUIButton label="Share" systemImage="square.and.arrow.up" onPress={shareAttachment} />
            {supportsFileClipboard ? <SwiftUIButton label="Copy file" systemImage="doc.on.doc" onPress={copyAttachment} /> : null}
          </SwiftUIControlGroup>
          <SwiftUIDivider />
          {message.role === 'user' && !message.text ? <>
            <SwiftUIButton label="Edit message" systemImage="pencil" onPress={() => runMessageAction('edit')} />
            <SwiftUIButton label="Delete message" role="destructive" systemImage="trash" onPress={() => runMessageAction('delete')} />
            <SwiftUIDivider />
          </> : null}
          <SwiftUIButton label={attachment.kind === 'image' ? 'Save image' : 'Save to Files'} systemImage="square.and.arrow.down" onPress={saveAttachment} />
          <SwiftUIButton label="Attachment info" systemImage="info.circle" onPress={() => Alert.alert(attachment.name, `${attachment.mimeType}\n${formatAttachmentSize(attachment.size)}`)} />
        </>
      )}
    >
      {children}
    </NativeObjectContextMenu>
  );
}

function ResolvedAttachmentImage({ attachment, variant }: { attachment: Attachment; variant: 'message' | 'preview' | 'composer' }) {
  const [uri, setUri] = useState(attachment.uri);
  const [failed, setFailed] = useState(false);
  const style = variant === 'preview'
    ? styles.attachmentContextImagePreview
    : variant === 'composer' ? styles.attachmentImage : styles.sentAttachmentImage;

  useEffect(() => {
    setUri(attachment.uri);
    setFailed(false);
    if (attachment.uri) return;
    let cancelled = false;
    const resolve = variant === 'message' || variant === 'composer'
      ? downloadAttachmentThumbnail(attachment.id)
      : downloadAttachment(attachment.id, attachment.name);
    void resolve.then((file) => {
      if (!cancelled) setUri(file.uri);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [attachment.id, attachment.name, attachment.uri, variant]);

  if (uri) return <Image accessibilityLabel={attachment.name} source={{ uri }} style={style} />;
  return (
    <View accessibilityLabel={attachment.name} style={[style, styles.attachmentImagePlaceholder]}>
      {failed
        ? <Icon name="photo.badge.exclamationmark" size={22} color={COLORS.muted} />
        : <ActivityIndicator color={COLORS.muted} size="small" />}
    </View>
  );
}

function toolActivityIcon(name?: string) {
  switch (name) {
    case 'read':
      return FileText;
    case 'write':
    case 'edit':
      return FilePenLine;
    case 'bash':
      return Terminal;
    case 'ls':
      return List;
    case 'find':
      return FolderSearch;
    case 'grep':
      return Search;
    default:
      return Wrench;
  }
}

function WorkTriggerIcon({ steps, active }: { steps: TimelineStep[]; active: boolean }) {
  const compaction = steps.find((step) => step.kind === 'compaction');
  if (compaction?.kind === 'compaction') {
    if (compaction.compaction.status === 'in_progress') return <Loader2 color={COLORS.muted} size={14} />;
    if (compaction.compaction.status === 'failed') return <XCircle color={COLORS.critical} size={14} />;
    return <Minimize2 color={COLORS.muted} size={14} />;
  }
  const workspace = steps.find((step) => step.kind === 'workspace');
  if (workspace?.kind === 'workspace') {
    if (['expired', 'unavailable'].includes(workspace.workspace.state ?? '')) return <XCircle color={COLORS.critical} size={14} />;
    if (workspaceIsActive(workspace.workspace.state)) return <Server color={COLORS.muted} size={14} />;
  }
  const tools = steps.filter((step) => step.kind === 'tool');
  const runningTool = tools.find((step) => step.tool.status === 'running');
  if (runningTool?.kind === 'tool') {
    const RunningToolIcon = toolActivityIcon(runningTool.tool.tool);
    return <RunningToolIcon color={COLORS.muted} size={14} />;
  }
  if (active && tools.length > 0) return <Wrench color={COLORS.muted} size={14} />;
  if (active) return <Brain color={COLORS.muted} size={14} />;
  if (tools.length > 0) return <Wrench color={COLORS.muted} size={14} />;
  if (workspace && !steps.some((step) => step.kind === 'reasoning' && step.text)) return <Server color={COLORS.muted} size={14} />;
  return <Brain color={COLORS.muted} size={14} />;
}

function useElapsedMs(startTs: number, active: boolean, finalMs?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active, startTs]);
  if (finalMs !== undefined) return finalMs;
  if (!active) return 0;
  return Math.max(0, now - startTs);
}

function workLabel(steps: TimelineStep[], active: boolean, durationMs?: number): string {
  const compaction = steps.find((step) => step.kind === 'compaction');
  if (compaction?.kind === 'compaction') {
    if (compaction.compaction.status === 'in_progress') return 'Compacting context…';
    if (compaction.compaction.status === 'failed') return 'Context compaction failed';
    return 'Compacted context';
  }
  const workspace = steps.find((step) => step.kind === 'workspace');
  if (workspace?.kind === 'workspace') {
    if (workspace.workspace.state === 'waiting') return `Waiting for workspace${typeof workspace.workspace.position === 'number' ? ` · queue #${workspace.workspace.position}` : ''}`;
    if (workspace.workspace.state === 'provisioning') return 'Starting workspace…';
    if (['expired', 'unavailable'].includes(workspace.workspace.state ?? '')) return `Workspace ${workspace.workspace.state}`;
  }
  const runningTool = steps.find((step) => step.kind === 'tool' && step.tool.status === 'running');
  if (runningTool?.kind === 'tool') return `Running ${runningTool.tool.tool ?? 'tool'}…`;
  if (active) return steps.some((step) => step.kind === 'tool') ? 'Working…' : 'Thinking…';
  return completedActivityLabel(steps, durationMs);
}

function toolStepSummary(step: Extract<TimelineStep, { kind: 'tool' }>['tool']): string {
  const args = step.arguments;
  if (!args || typeof args !== 'object') return step.tool ?? 'tool';
  const record = args as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : undefined;
  const command = typeof record.command === 'string' ? record.command : undefined;
  const pattern = typeof record.pattern === 'string' ? record.pattern : undefined;
  const query = typeof record.query === 'string' ? record.query : undefined;
  if (step.tool === 'bash' && command) {
    const oneLine = command.replace(/\s+/g, ' ').trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
  }
  return path ?? pattern ?? query ?? step.tool ?? 'tool';
}

const ToolStepRow = memo(function ToolStepRow({ step }: { step: Extract<TimelineStep, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const failed = step.tool.status === 'failed' || step.tool.isError;
  const running = step.tool.status === 'running';
  const hasBody = step.tool.arguments !== undefined || Boolean(step.tool.output);
  const details = useMemo(() => [
    step.tool.arguments === undefined ? '' : typeof step.tool.arguments === 'string' ? step.tool.arguments : JSON.stringify(step.tool.arguments, null, 2),
    step.tool.output ?? '',
  ].filter(Boolean).join('\n'), [step.tool.arguments, step.tool.output]);
  const seconds = step.tool.durationMs === undefined ? null : Math.max(0, Math.round(step.tool.durationMs / 1000));
  const ToolIcon = toolActivityIcon(step.tool.tool);
  return (
    <View style={styles.workStep}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: hasBody ? open : undefined }}
        disabled={!hasBody}
        onPress={() => setOpen((value) => !value)}
        style={styles.workToolTrigger}
      >
        {running
          ? <Loader2 color={COLORS.muted} size={13} />
          : failed
            ? <XCircle color={COLORS.critical} size={13} />
            : <ToolIcon color={COLORS.muted} size={13} />}
        <Text style={styles.workToolName}>{step.tool.tool ?? 'Tool'}</Text>
        <Text numberOfLines={1} style={styles.workToolSummary}>{toolStepSummary(step.tool)}</Text>
        {seconds !== null && <Text style={styles.workToolDuration}>{seconds}s</Text>}
        {hasBody && <Icon name={open ? 'chevron.down' : 'chevron.right'} size={10} color={COLORS.dim} weight="semibold" />}
      </Pressable>
      {open && details ? (
        <ScrollView nestedScrollEnabled style={styles.workDetailScroller}>
          <Text selectable style={styles.workDetail}>{details}</Text>
        </ScrollView>
      ) : null}
      {running && !hasBody ? <Text style={styles.workRunning}>Running…</Text> : null}
    </View>
  );
});

function CompactionStepContent({ step }: { step: Extract<TimelineStep, { kind: 'compaction' }> }) {
  const item = step.compaction;
  return (
    <View style={styles.compactionDetail}>
      {item.error ? <Text style={styles.compactionError}>{item.error}</Text> : null}
      {item.summary ? (
        <View style={styles.compactionSection}>
          <Text style={styles.compactionSectionTitle}>Compacted summary</Text>
          <SafeMarkdown compact>{item.summary}</SafeMarkdown>
        </View>
      ) : null}
      {item.retained_turns.length ? (
        <View style={styles.compactionSection}>
          <Text style={styles.compactionSectionTitle}>Kept verbatim</Text>
          {item.retained_turns.map((entry, index) => (
            <View key={`${entry.role}:${index}`} style={styles.compactionTurn}>
              <Text style={styles.compactionRole}>{entry.role}</Text>
              <Text selectable style={styles.compactionContent}>{entry.content}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function WorkBlock({ steps, active, durationMs }: { steps: TimelineStep[]; active: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const label = workLabel(steps, active, durationMs);
  return (
    <View style={styles.workBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((value) => !value)}
        style={styles.reasoningTrigger}
      >
        <WorkTriggerIcon active={active} steps={steps} />
        <Text style={styles.reasoningLabel}>{label}</Text>
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={10} color={COLORS.dim} weight="semibold" />
      </Pressable>
      {open && (
        <View style={styles.reasoningBody}>
          {steps.map((step, index) => {
            if (step.kind === 'reasoning') {
              return <SafeMarkdown compact key={`reasoning:${index}`} streaming={step.active}>{step.text || (step.active ? 'Thinking…' : '')}</SafeMarkdown>;
            }
            if (step.kind === 'workspace') {
              const detail = step.workspace.error ?? step.workspace.state?.replaceAll('_', ' ') ?? 'Workspace';
              const failed = ['expired', 'unavailable'].includes(step.workspace.state ?? '');
              return <View key={`workspace:${index}`} style={styles.workRow}>{failed ? <XCircle color={COLORS.critical} size={13} /> : <Server color={COLORS.muted} size={13} />}<Text style={styles.workRowText}>{detail}</Text></View>;
            }
            if (step.kind === 'compaction') {
              return <CompactionStepContent key={step.compaction.id} step={step} />;
            }
            return <ToolStepRow key={step.tool.id ?? `tool:${index}`} step={step} />;
          })}
        </View>
      )}
    </View>
  );
}

function otherOutputItems(outputItems?: unknown[]): Array<Record<string, unknown>> {
  const known = new Set(['message', 'reasoning', 'pulpo_tool', 'pulpo_workspace', 'pulpo_attachment', 'pulpo_compaction']);
  return (outputItems ?? []).filter((item): item is Record<string, unknown> => {
    const type = (item as { type?: unknown }).type;
    return typeof type === 'string' && !known.has(type);
  });
}

function outputItemTitle(item: Record<string, unknown>): string {
  const type = String(item.type ?? 'output').replaceAll('_', ' ');
  return type.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function responseModel(message: Message, models: Model[], fallback: Model): Model {
  const modelId = message.modelId ?? message.chatModelId;
  if (!modelId) return fallback;
  return resolveDisplayModel(models, modelId, (unavailableModelId) => ({
    ...MODELS[1],
    id: unavailableModelId,
    name: unavailableModelId,
    lab: 'Model',
    detail: 'No longer available in this instance',
    agentEnabled: false,
  }));
}

function BranchControls({ branches, activeIndex, onActivate, disabled = false }: {
  branches: ResponseBranch[];
  activeIndex: number;
  onActivate: (branchId: string) => Promise<void>;
  disabled?: boolean;
}) {
  const activate = useCallback((index: number) => {
    const branch = branches[index];
    if (!branch) return;
    void onActivate(branch.id).catch((error) => {
      Alert.alert('Couldn’t switch version', error instanceof Error ? error.message : 'The current version was kept.');
    });
  }, [branches, onActivate]);
  return (
    <View accessibilityLabel={`Version ${activeIndex + 1} of ${branches.length}`} style={styles.branchControls}>
      <IconAction disabled={disabled || activeIndex <= 0} icon="chevron.left" label="Previous version" onPress={() => activate(activeIndex - 1)} />
      <Text style={styles.branchLabel}>{`${activeIndex + 1} / ${branches.length}`}</Text>
      <IconAction disabled={disabled || activeIndex >= branches.length - 1} icon="chevron.right" label="Next version" onPress={() => activate(activeIndex + 1)} />
    </View>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  model,
  onEdit,
  onRegenerate,
  onActivateBranch,
  editingLocked = false,
}: {
  message: Message;
  model: Model;
  onEdit: (message: Message, content: string) => void;
  onRegenerate: (message: Message) => void;
  onActivateBranch: (message: Message, branchId: string) => Promise<void>;
  editingLocked?: boolean;
}) {
  const { showReasoning } = useAppPreferences();
  const branches = message.branches ?? [];
  const branchIndex = message.activeBranch ?? 0;
  const [capacityPending, setCapacityPending] = useState(false);
  const [streamingFallbackDurationMs, setStreamingFallbackDurationMs] = useState<number>();
  const streaming = message.status === 'streaming' || message.status === 'queued';
  const responseStartedAt = useMemo(() => message.createdAt ?? Date.now(), [message.createdAt]);
  const extraOutput = useMemo(() => otherOutputItems(message.outputItems), [message.outputItems]);
  const capacityWorkspace = useMemo(() => (message.outputItems ?? []).some((item) => {
    const value = item as { type?: string; state?: string };
    return value.type === 'pulpo_workspace' && ['waiting', 'unavailable'].includes(value.state ?? '');
  }), [message.outputItems]);
  const timeline = useMemo(() => {
    if (message.role !== 'assistant') return [];
    if (message.outputItems?.length) return buildMessageTimeline(message.outputItems, showReasoning);
    return buildLegacyMessageTimeline({
      reasoning: message.reasoning,
      text: message.text,
      streaming,
      showReasoning,
      reasoningDurationMs: message.thinkSeconds === undefined ? undefined : message.thinkSeconds * 1000,
    });
  }, [message.outputItems, message.reasoning, message.role, message.text, message.thinkSeconds, showReasoning, streaming]);
  const elapsedMs = useElapsedMs(responseStartedAt, streaming && message.role === 'assistant', message.latencyMs);
  const activitySegments = timeline.filter((segment) => segment.kind === 'activity');
  const lastActivityTimelineIndex = timeline.reduce(
    (lastIndex, segment, index) => segment.kind === 'activity' ? index : lastIndex,
    -1,
  );
  const lastActivitySegment = timeline[lastActivityTimelineIndex];
  const hasTextAfterLastActivity = timeline
    .slice(lastActivityTimelineIndex + 1)
    .some((segment) => segment.kind === 'text');
  const activityFinishedDuringStream = streaming
    && activitySegments.length === 1
    && lastActivitySegment?.kind === 'activity'
    && hasTextAfterLastActivity;

  useEffect(() => {
    if (!streaming) return;
    if (!activityFinishedDuringStream) {
      setStreamingFallbackDurationMs(undefined);
      return;
    }
    setStreamingFallbackDurationMs((duration) => (
      duration ?? Math.max(0, Date.now() - responseStartedAt)
    ));
  }, [activityFinishedDuringStream, responseStartedAt, streaming]);
  return (
    <View style={message.role === 'user' ? styles.userRow : styles.assistantRow}>
      {message.role === 'user' ? (
        <View style={styles.userMessageContent}>
          {message.attachments && message.attachments.length > 0 && (
            <View style={styles.sentAttachments}>
              {message.attachments.map((attachment) => (
                <SentAttachmentContextMenu attachment={attachment} key={attachment.id} message={message} onEdit={onEdit} onRegenerate={onRegenerate}>
                  {attachment.kind === 'image' ? (
                    <ResolvedAttachmentImage attachment={attachment} variant="message" />
                  ) : (
                    <View style={styles.sentFileAttachment}>
                      <Icon name="doc.fill" size={17} color={COLORS.muted} />
                      <Text numberOfLines={1} style={styles.sentFileName}>{attachment.name}</Text>
                    </View>
                  )}
                </SentAttachmentContextMenu>
              ))}
            </View>
          )}
          {message.text.length > 0 && (
            <MessageContextMenu message={message} onEdit={onEdit} onRegenerate={onRegenerate}>
              <View style={styles.userMessageContextContent}>
                <View style={styles.userBubble}>
                  <SafeMarkdown containerStyle={styles.userMessageMarkdown}>{message.text}</SafeMarkdown>
                </View>
              </View>
            </MessageContextMenu>
          )}
        </View>
      ) : (
        <View>
          <View style={styles.assistantHeader}>
            <ModelMark model={model} size={26} />
            <Text style={styles.assistantName}>{model.name}</Text>
            <Text style={styles.messageTime}>{timeAgo(message.createdAt ?? Date.now())}</Text>
          </View>
          {timeline.length ? (
            <MessageContextMenu message={message} onEdit={onEdit} onRegenerate={onRegenerate}>
              <View style={styles.assistantContent}>
                {timeline.map((segment, index) => {
                  if (segment.kind === 'activity') {
                    const active = timelineActivityIsActive(timeline, index, streaming);
                    const segmentDurationMs = activityDurationMs(segment.steps);
                    const useResponseDurationFallback = activitySegments.length === 1
                      && index === lastActivityTimelineIndex
                      && (!streaming || activityFinishedDuringStream);
                    return <WorkBlock
                      active={active}
                      durationMs={segmentDurationMs ?? (useResponseDurationFallback
                        ? streamingFallbackDurationMs ?? elapsedMs
                        : undefined)}
                      key={`activity:${index}`}
                      steps={segment.steps}
                    />;
                  }
                  return <SafeMarkdown key={`text:${index}`} streaming={streaming && !timeline.slice(index + 1).some((item) => item.kind === 'text')}>{segment.text}</SafeMarkdown>;
                })}
              </View>
            </MessageContextMenu>
          ) : message.error ? (
            <MessageContextMenu message={message} onEdit={onEdit} onRegenerate={onRegenerate}>
              <View style={styles.responseError}><Icon name="exclamationmark.triangle" size={15} color={COLORS.critical} /><Text style={styles.responseErrorText}>{message.error}</Text><Pressable accessibilityRole="button" onPress={() => onRegenerate(message)}><Text style={styles.tryAgainText}>Try again</Text></Pressable></View>
            </MessageContextMenu>
          ) : streaming ? <ResponsePendingIndicator /> : null}
          {extraOutput.map((item, index) => {
            const details = JSON.stringify(item, null, 2).slice(0, 4000);
            return <View key={`${String(item.type)}:${index}`} style={styles.otherOutput}>
              <View style={styles.workRow}><Icon name="doc.text.magnifyingglass" size={13} color={COLORS.muted} /><Text style={styles.workRowTitle}>{outputItemTitle(item)}</Text></View>
              <Text selectable style={styles.workDetail}>{details}</Text>
            </View>;
          })}
          {message.attachments && message.attachments.length > 0 && (
            <View style={[styles.sentAttachments, styles.assistantAttachments]}>
              {message.attachments.map((attachment) => (
                <SentAttachmentContextMenu attachment={attachment} key={attachment.id} message={message} onEdit={onEdit} onRegenerate={onRegenerate}>
                  {attachment.kind === 'image' ? (
                    <ResolvedAttachmentImage attachment={attachment} variant="message" />
                  ) : (
                    <View style={styles.sentFileAttachment}>
                      <Icon name="doc.fill" size={17} color={COLORS.muted} />
                      <Text numberOfLines={1} style={styles.sentFileName}>{attachment.name}</Text>
                    </View>
                  )}
                </SentAttachmentContextMenu>
              ))}
            </View>
          )}
          {message.error && timeline.length > 0 && <View style={styles.responseError}><Icon name="exclamationmark.triangle" size={15} color={COLORS.critical} /><Text style={styles.responseErrorText}>{message.error}</Text><Pressable accessibilityRole="button" onPress={() => onRegenerate(message)}><Text style={styles.tryAgainText}>Try again</Text></Pressable></View>}
          {!message.error && message.status === 'stopped' && <MessageContextMenu message={message} onEdit={onEdit} onRegenerate={onRegenerate}><View style={styles.responseError}><Icon name="stop.circle" size={15} color={COLORS.muted} /><Text style={styles.responseErrorText}>Response stopped before completion.</Text><Pressable accessibilityRole="button" onPress={() => onRegenerate(message)}><Text style={styles.tryAgainText}>Try again</Text></Pressable></View></MessageContextMenu>}
          {message.agentMode && streaming && capacityWorkspace && (
            <Pressable
              accessibilityRole="button"
              disabled={capacityPending}
              onPress={() => {
                setCapacityPending(true);
                void continueWithoutAgent(message.id)
                  .catch((error) => Alert.alert('Couldn’t continue', error instanceof Error ? error.message : undefined))
                  .finally(() => setCapacityPending(false));
              }}
              style={({ pressed }) => [styles.continueButton, pressed && styles.navRowPressed]}
            >
              <Text style={styles.continueButtonText}>{capacityPending ? 'Continuing…' : 'Continue without agent tools'}</Text>
            </Pressable>
          )}
          {message.text && message.meta && <Text style={styles.messageMeta}>{message.meta}</Text>}
        </View>
      )}
      {branches.length > 1 && message.chatId ? (
        <BranchControls activeIndex={branchIndex} branches={branches} disabled={editingLocked} onActivate={(branchId) => onActivateBranch(message, branchId)} />
      ) : null}
    </View>
  );
});

const StreamingResponse = memo(function StreamingResponse({
  session,
  model,
  onComplete,
}: {
  session: StreamingSession;
  model: Model;
  onComplete: (session: StreamingSession) => void;
}) {
  const [draft, setDraft] = useState('');
  const { smoothStreaming } = useAppPreferences();

  useEffect(() => {
    if (!smoothStreaming) {
      setDraft(session.response);
      const completionTimer = setTimeout(() => onComplete(session), 0);
      return () => clearTimeout(completionTimer);
    }
    const words = session.response.split(' ');
    const wordsPerFrame = Math.max(1, Math.ceil(words.length / 28));
    let index = 0;
    const timer = setInterval(() => {
      index = Math.min(words.length, index + wordsPerFrame);
      setDraft(words.slice(0, index).join(' '));
      if (index >= words.length) {
        clearInterval(timer);
        onComplete(session);
      }
    }, 60);
    return () => clearInterval(timer);
  }, [onComplete, session, smoothStreaming]);

  return (
    <View accessibilityLabel="Assistant is responding" accessibilityRole="text" style={styles.assistantRow}>
      <View style={styles.assistantHeader}>
        <ModelMark model={model} size={26} />
        <Text style={styles.assistantName}>{model.name}</Text>
        <Text style={styles.messageTime}>now</Text>
      </View>
      {!draft && <ResponsePendingIndicator />}
      <Text accessible={false} style={[styles.assistantText, styles.draftText]}>{draft}<BlinkingCaret /></Text>
    </View>
  );
});

const NativeModelMenu = memo(function NativeModelMenu({ model, models, onSelectModel, temporary = false }: { model: Model; models: Model[]; onSelectModel: (model: Model) => void; temporary?: boolean }) {
  const colorScheme = useColorScheme();
  const favoritesSection = '__favorites__';
  const [section, setSection] = useState<ModelSection>(favoritesSection);
  const favoriteModelIds = usePreferencesStore((state) => state.favoriteModelIds);
  const providerOrder = usePreferencesStore((state) => state.providerOrder);
  const availableProviderIds = [...new Set(models.map((candidate) => candidate.providerGroupId))];
  const modelSections = [
    { id: favoritesSection, label: 'Favorites' },
    ...resolveVisibleOrder(providerOrder, availableProviderIds).map((id) => ({
      id,
      label: models.find((candidate) => candidate.providerGroupId === id)?.lab ?? 'Internal',
    })),
  ];
  const sectionLabel = modelSections.find((candidate) => candidate.id === section)?.label ?? 'Favorites';
  const visibleModels = section === favoritesSection
    ? orderedModelsById(models, favoriteModelIds)
    : models.filter((candidate) => candidate.providerGroupId === section);

  return (
    <SwiftUIHost key={temporary ? 'temporary' : 'default'} matchContents style={styles.modelMenuHost}>
      <SwiftUIMenu
        label={(
          <SwiftUILabel
            title={model.name}
            icon={(
              <SwiftUIImage
                uiImage={Image.resolveAssetSource(model.labIcon ?? model.icon).uri}
                modifiers={[
                  resizable(),
                  frame({ width: 22, height: 22 }),
                  ...(temporary ? [grayscale(1), brightness(1)] : []),
                ]}
              />
            )}
          />
        )}
        modifiers={[
          buttonStyle(temporary ? 'glassProminent' : 'glass'),
          buttonBorderShape('capsule'),
          controlSize('regular'),
          ...(temporary ? [tint('rgba(175,82,222,0.22)'), foregroundStyle(colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e')] : []),
          swiftUIAccessibilityLabel(`Model, ${model.name}`),
          swiftUIAccessibilityHint('Opens models and lab sections'),
        ]}
      >
        <SwiftUISection key="models" title={sectionLabel}>
          {visibleModels.map((candidate) => (
            <SwiftUIButton
              key={candidate.id}
              onPress={() => onSelectModel(candidate)}
            >
              <NativeModelMenuRow
                label={candidate.name}
                model={candidate}
                selected={candidate.id === model.id}
                whiteIcons={temporary}
              />
            </SwiftUIButton>
          ))}
        </SwiftUISection>
        <SwiftUIDivider key="divider" />
        <SwiftUIMenu
          key="sections"
          label={(
            <SwiftUILabel
              title="Labs"
              icon={<SwiftUIImage color={temporary ? '#f2f2f7' : undefined} systemName="flask" />}
            />
          )}
        >
          {modelSections.map((candidateSection) => (
            <SwiftUIButton
              key={candidateSection.id}
              modifiers={[menuActionDismissBehavior('disabled')]}
              onPress={() => {
                setSection(candidateSection.id);
                Haptics.selectionAsync();
              }}
            >
              <NativeModelSectionRow
                label={candidateSection.label}
                section={candidateSection.id}
                models={models}
                selected={candidateSection.id === section}
                whiteIcons={temporary}
              />
            </SwiftUIButton>
          ))}
        </SwiftUIMenu>
      </SwiftUIMenu>
    </SwiftUIHost>
  );
});

function NativeModelMenuRow({ label, model, selected = false, whiteIcons = false }: { label: string; model: Model; selected?: boolean; whiteIcons?: boolean }) {
  return (
    <SwiftUIHStack modifiers={[frame({ width: 220 })]} spacing={10}>
      <SwiftUILabel
        title={label}
        icon={<SwiftUIImage uiImage={Image.resolveAssetSource(model.menuIcon ?? model.icon).uri} modifiers={[resizable(), frame({ width: 20, height: 20 }), ...(whiteIcons ? [grayscale(1), brightness(1)] : [])]} />}
      />
      <SwiftUISpacer />
      {selected && <SwiftUIImage color={whiteIcons ? '#f2f2f7' : undefined} systemName="checkmark" size={15} />}
    </SwiftUIHStack>
  );
}

function NativeModelSectionRow({ label, section, models, selected = false, whiteIcons = false }: { label: string; section: ModelSection; models: Model[]; selected?: boolean; whiteIcons?: boolean }) {
  const labModel = section === '__favorites__' ? null : models.find((model) => model.providerGroupId === section);
  return (
    <SwiftUIHStack modifiers={[frame({ width: 220 })]} spacing={10}>
      <SwiftUILabel
        title={label}
        icon={labModel
          ? <SwiftUIImage uiImage={Image.resolveAssetSource(labModel.labIcon ?? labModel.icon).uri} modifiers={[resizable(), frame({ width: 20, height: 20 }), ...(whiteIcons ? [grayscale(1), brightness(1)] : [])]} />
          : <SwiftUIImage color={whiteIcons ? '#f2f2f7' : undefined} systemName="star.fill" size={18} />}
      />
      <SwiftUISpacer />
      {selected && <SwiftUIImage color={whiteIcons ? '#f2f2f7' : undefined} systemName="checkmark" size={15} />}
    </SwiftUIHStack>
  );
}

function SuggestedPromptButton({ label, accessible, onPress, temporary = false }: { label: string; accessible: boolean; onPress: () => void; temporary?: boolean }) {
  const colorScheme = useColorScheme();
  const temporaryStyle = temporary
    ? colorScheme === 'dark' ? styles.temporarySuggestionCardDark : styles.temporarySuggestionCardLight
    : undefined;
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost ignoreSafeArea="keyboard" style={[styles.suggestionCard, temporaryStyle, accessible && styles.suggestionCardAccessible]}>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            buttonStyle('plain'),
            frame({ maxWidth: Infinity, minHeight: 68, alignment: 'leading' }),
            padding({ horizontal: 13, vertical: 11 }),
            swiftUIAccessibilityLabel(label),
            swiftUIAccessibilityHint('Sends this suggestion'),
          ]}
        >
          <SwiftUIRNHostView matchContents>
            <Text maxFontSizeMultiplier={1.6} pointerEvents="none" style={styles.suggestionLabel}>{label}</Text>
          </SwiftUIRNHostView>
        </SwiftUIButton>
      </SwiftUIHost>
    );
  }
  return (
    <Pressable
      accessibilityHint="Sends this suggestion"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.suggestionCard, temporaryStyle, accessible && styles.suggestionCardAccessible, pressed && styles.navRowPressed]}
    >
      <Text maxFontSizeMultiplier={1.6} style={styles.suggestionLabel}>{label}</Text>
    </Pressable>
  );
}

function ChatView({
  messages, chatId, chatLoaded, keyboardLayoutEnabled, model, models, prototypeModel, presetSelections, input, onChangeInput, onSend, assistantStatus, streamingSession,
  onStreamingComplete, onEdit, onRegenerate, onActivateBranch, onStop, onOpenPanel, onOpenModelPicker, onSelectModel, onSelectPreset, onNewChat, onSaveTemporary, persistentSidebar, temporary, expired, savingTemporary, onTemporaryChange,
}: {
  messages: Message[];
  chatId: string | null;
  chatLoaded: boolean;
  keyboardLayoutEnabled: boolean;
  model: Model;
  models: Model[];
  prototypeModel?: PrototypeModel;
  presetSelections: GenerationSelections;
  input: string;
  onChangeInput: (value: string) => void;
  onSend: (value?: string, attachments?: PreparedAttachment[], options?: SendOptions) => Promise<boolean>;
  assistantStatus: 'idle' | 'thinking' | 'streaming';
  streamingSession: StreamingSession | null;
  onStreamingComplete: (session: StreamingSession) => void;
  onEdit: (message: Message, content: string, attachments?: PreparedAttachment[], agentMode?: boolean) => Promise<boolean>;
  onRegenerate: (message: Message) => void;
  onActivateBranch: (message: Message, branchId: string) => Promise<void>;
  onStop: () => void;
  onOpenPanel: () => void;
  persistentSidebar: boolean;
  onOpenModelPicker: () => void;
  onSelectModel: (model: Model) => void;
  onSelectPreset: (presetId: string, choiceId: string) => void;
  onNewChat: () => void;
  onSaveTemporary: () => void;
  temporary: boolean;
  expired: boolean;
  savingTemporary: boolean;
  onTemporaryChange: (value: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { reduceMotion } = useAccessibilityPreferences();
  const { fontScale, height: windowHeight, width: windowWidth } = useWindowDimensions();
  const horizontalPadding = responsiveHorizontalPadding(windowWidth);
  const accessibilityLayout = fontScale >= 1.6;
  const listRef = useRef<FlatList<Message>>(null);
  const isNearBottom = useRef(true);
  const shouldAutoFollow = useRef(true);
  const readerInteracting = useRef(false);
  const chatTailPending = useRef(true);
  const pendingFollowFrame = useRef<number | null>(null);
  const tailSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedTurnFollowRevision = useRef(0);
  const measuredContentHeight = useRef(0);
  const preferredAgentMode = usePreferencesStore((state) => state.agentMode);
  const agentAvailable = usePrototypeStore((state) => state.agentAvailable);
  const productionInstanceUrl = useSessionStore((state) => state.instanceUrl);
  const productionUserId = useSessionStore((state) => state.user?.id);
  const agentNamespace = productionUserId ? cacheNamespace(productionInstanceUrl, productionUserId) : null;
  const canUseAgent = agentAvailable && model.agentEnabled;
  const [agentEnabled, setAgentEnabled] = useState(() => preferredAgentMode && canUseAgent);
  const activeAgentEnabled = canUseAgent && agentEnabled;
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [messageEdit, setMessageEdit] = useState<MessageEditSession | null>(null);
  const preservedComposerRef = useRef<{
    input: string;
    attachments: ComposerAttachment[];
    agentEnabled: boolean;
  } | null>(null);
  const messageEditChatIdRef = useRef(chatId);
  const composerInputRef = useRef<TextInput>(null);
  const [sending, setSending] = useState(false);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [headerOverlayHeight, setHeaderOverlayHeight] = useState(insets.top + 64);
  const [promptConfig, setPromptConfig] = useState({
    enabled: true,
    count: 4,
    prompts: DEFAULT_SUGGESTED_PROMPTS,
  });
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const suggestionGridHeight = useSharedValue(0);
  const temporaryProgress = useSharedValue(temporary ? 1 : 0);
  const realtimeConnectionPhase = useRealtimeStore((state) => state.connectionPhase);
  const syncError = useRealtimeStore((state) => state.syncError);
  const networkState = Network.useNetworkState();
  const networkOffline = networkState.isConnected === false || networkState.isInternetReachable === false;
  const connectionState = networkOffline
    ? 'offline'
    : realtimeConnectionPhase === 'connected' ? 'online' : realtimeConnectionPhase;
  const showConnectionBanner = shouldShowConnectionBanner({
    phase: realtimeConnectionPhase,
    offline: networkOffline,
    syncError,
  });
  const isEmptyConversation = messages.length === 0;
  const suggestions = useMemo(
    () => promptConfig.enabled ? pickSuggestedPrompts(promptConfig.prompts, promptConfig.count) : [],
    // Re-roll when opening a new empty chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, isEmptyConversation, promptConfig],
  );

  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ enabled: boolean; count: number; prompts: SuggestedPrompt[] }>('/api/interface/suggested-prompts')
      .then((config) => { if (!cancelled) setPromptConfig(config); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const keyboardSafeAreaOffset = Math.max(insets.bottom, 10) - 8;
  const keyboardOffset = useMemo(
    () => ({ closed: 0, opened: keyboardSafeAreaOffset }),
    [keyboardSafeAreaOffset],
  );
  const renderChatScrollComponent = useCallback((props: ScrollViewProps) => (
    <ChatScrollView
      {...props}
      freezeKeyboardLayout={!keyboardLayoutEnabled}
      keyboardOffset={keyboardSafeAreaOffset}
    />
  ), [keyboardLayoutEnabled, keyboardSafeAreaOffset]);
  const emptyStateAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{
      translateY: -resolveKeyboardLayoutProgress(keyboardProgress.value, keyboardLayoutEnabled) * (
        Math.min(64, windowHeight * 0.065) + suggestionGridHeight.value * 0.5
      ),
    }],
  }), [keyboardLayoutEnabled]);
  const suggestionsAnimatedStyle = useAnimatedStyle(() => {
    const progress = resolveKeyboardLayoutProgress(keyboardProgress.value, keyboardLayoutEnabled);
    return {
      height: suggestionGridHeight.value > 0
        ? suggestionGridHeight.value * (1 - progress)
        : undefined,
      marginTop: interpolate(progress, [0, 1], [30, 0]),
      opacity: interpolate(progress, [0, 0.65], [1, 0]),
      transform: [{ translateY: interpolate(progress, [0, 1], [0, -14]) }],
    };
  }, [keyboardLayoutEnabled]);
  const temporarySurfaceAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      temporaryProgress.value,
      [0, 1],
      colorScheme === 'dark' ? ['#000000', '#080312'] : ['#ffffff', '#f4f0ff'],
    ),
  }));
  const temporaryLabelAnimatedStyle = useAnimatedStyle(() => ({
    opacity: temporaryProgress.value,
    transform: [
      { translateY: interpolate(temporaryProgress.value, [0, 1], [6, 0]) },
      { scale: interpolate(temporaryProgress.value, [0, 1], [0.98, 1]) },
    ],
  }));

  const presetLabel = generationSummary(prototypeModel, presetSelections);
  const hasGenerationPresets = Boolean(prototypeModel?.presets.some((preset) => preset.choices.length > 0));

  useEffect(() => {
    setAgentEnabled(preferredAgentMode && canUseAgent);
  }, [canUseAgent, preferredAgentMode]);

  useEffect(() => {
    const target = temporary ? 1 : 0;
    temporaryProgress.value = reduceMotion
      ? target
      : withTiming(target, {
        duration: temporary ? 320 : 240,
      });
  }, [reduceMotion, temporary, temporaryProgress]);

  useEffect(() => {
    if (!hasGenerationPresets) setPresetPickerOpen(false);
  }, [hasGenerationPresets]);

  const openPresetPicker = useCallback(() => {
    Haptics.selectionAsync();
    setPresetPickerOpen(true);
  }, []);

  const toggleAgent = useCallback(() => {
    if (!canUseAgent || !agentNamespace) return;
    const next = !activeAgentEnabled;
    setAgentEnabled(next);
    if (!messageEdit) void usePreferencesStore.getState().setNamespacedAgentMode(agentNamespace, next);
    Haptics.selectionAsync();
  }, [activeAgentEnabled, agentNamespace, canUseAgent, messageEdit]);

  const restoreComposer = useCallback(() => {
    const preserved = preservedComposerRef.current;
    preservedComposerRef.current = null;
    setMessageEdit(null);
    if (!preserved) return;
    onChangeInput(preserved.input);
    setAttachments(preserved.attachments);
    setAgentEnabled(preserved.agentEnabled);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [onChangeInput]);

  const cleanupEditUploads = useCallback((session: MessageEditSession, values: ComposerAttachment[]) => {
    for (const attachment of values) {
      if (!attachment.serverId || session.originalAttachmentIds.has(attachment.serverId)) continue;
      void deleteUnreferencedAttachment(attachment.serverId).catch(() => undefined);
    }
  }, []);

  const cancelMessageEdit = useCallback(() => {
    if (!messageEdit || sending) return;
    cleanupEditUploads(messageEdit, attachments);
    restoreComposer();
    Haptics.selectionAsync();
  }, [attachments, cleanupEditUploads, messageEdit, restoreComposer, sending]);

  useEffect(() => {
    if (messageEditChatIdRef.current === chatId) return;
    messageEditChatIdRef.current = chatId;
    if (!messageEdit) return;
    cleanupEditUploads(messageEdit, attachments);
    restoreComposer();
  }, [attachments, chatId, cleanupEditUploads, messageEdit, restoreComposer]);

  const beginMessageEdit = useCallback((message: Message) => {
    if (messageEdit || sending || assistantStatus !== 'idle') return;
    preservedComposerRef.current = { input, attachments, agentEnabled };
    const existing = message.attachments ?? [];
    setMessageEdit({ message, originalAttachmentIds: new Set(existing.map((attachment) => attachment.id)) });
    onChangeInput(message.text);
    setAgentEnabled(Boolean(message.agentMode));
    setAttachments(existing.map((attachment) => ({
      ...attachment,
      localId: `sent:${message.id}:${attachment.id}`,
      serverId: attachment.id,
      state: 'ready' as const,
    })));
    requestAnimationFrame(() => composerInputRef.current?.focus());
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [agentEnabled, assistantStatus, attachments, input, messageEdit, onChangeInput, sending]);

  const handleMessageEditAction = useCallback((message: Message, content: string) => {
    if (message.role === 'user') {
      beginMessageEdit(message);
      return;
    }
    void onEdit(message, content);
  }, [beginMessageEdit, onEdit]);

  const addAttachments = useCallback((incoming: ComposerAttachment[]) => {
    setAttachments((current) => {
      const known = new Set(current.map((attachment) => attachment.uri));
      return [...current, ...incoming.filter((attachment) => !known.has(attachment.uri))].slice(0, 6);
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const pickPhotos = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        quality: 0.9,
        selectionLimit: 6,
      });
      if (result.canceled) return;
      const batchId = Date.now();
      addAttachments(result.assets.map((asset, index) => ({
        id: `photo-${batchId}-${index}`,
        localId: `photo-${batchId}-${index}`,
        kind: 'image' as const,
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `Photo ${index + 1}`,
        size: asset.fileSize,
        uri: asset.uri,
        state: 'local' as const,
      })));
    } catch {
      Alert.alert('Couldn’t open Photos', 'Please try again or choose the image from Files.');
    }
  }, [addAttachments]);

  const takePhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Camera access is required',
          'Allow Pulpo to use the camera to capture an attachment.',
          permission.canAskAgain
            ? [{ text: 'OK' }]
            : [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const id = `camera-${Date.now()}`;
      addAttachments([{
        id,
        localId: id,
        kind: 'image',
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `Photo ${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
        size: asset.fileSize,
        uri: asset.uri,
        state: 'local',
      }]);
    } catch {
      Alert.alert('Camera unavailable', 'Pulpo could not open the camera on this device.');
    }
  }, [addAttachments]);

  const pickFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: '*/*',
      });
      if (result.canceled) return;
      const batchId = Date.now();
      addAttachments(result.assets.map((asset, index) => ({
        id: `file-${batchId}-${index}`,
        localId: `file-${batchId}-${index}`,
        kind: attachmentKind(asset.mimeType ?? 'application/octet-stream'),
        mimeType: asset.mimeType ?? 'application/octet-stream',
        name: asset.name,
        size: asset.size,
        uri: asset.uri,
        state: 'local' as const,
      })));
    } catch {
      Alert.alert('Couldn’t open Files', 'Please try choosing the file again.');
    }
  }, [addAttachments]);

  const armSubmittedTurnFollow = useCallback((): ChatFollowSnapshot => {
    submittedTurnFollowRevision.current += 1;
    const snapshot = {
      nearBottom: isNearBottom.current,
      autoFollow: shouldAutoFollow.current,
      readerInteracting: readerInteracting.current,
      tailPending: chatTailPending.current,
      revision: submittedTurnFollowRevision.current,
    };
    if (pendingFollowFrame.current !== null) {
      cancelAnimationFrame(pendingFollowFrame.current);
      pendingFollowFrame.current = null;
    }
    if (tailSettleTimer.current !== null) {
      clearTimeout(tailSettleTimer.current);
      tailSettleTimer.current = null;
    }
    // Sending explicitly asks to see the optimistic user row and the queued
    // assistant row. Hold this intent across keyboard/layout scroll events
    // until their final measured content height has settled.
    readerInteracting.current = false;
    isNearBottom.current = true;
    shouldAutoFollow.current = true;
    chatTailPending.current = true;
    return snapshot;
  }, []);

  const restoreSubmittedTurnFollow = useCallback((snapshot: ChatFollowSnapshot) => {
    // Direct reader interaction or navigation supersedes the send-time intent.
    if (snapshot.revision !== submittedTurnFollowRevision.current) return;
    if (pendingFollowFrame.current !== null) {
      cancelAnimationFrame(pendingFollowFrame.current);
      pendingFollowFrame.current = null;
    }
    if (tailSettleTimer.current !== null) {
      clearTimeout(tailSettleTimer.current);
      tailSettleTimer.current = null;
    }
    isNearBottom.current = snapshot.nearBottom;
    shouldAutoFollow.current = snapshot.autoFollow;
    readerInteracting.current = snapshot.readerInteracting;
    chatTailPending.current = snapshot.tailPending;
  }, []);

  const uploadOne = useCallback(async (attachment: ComposerAttachment): Promise<PreparedAttachment | null> => {
    if (attachment.state === 'ready' && attachment.serverId) return attachment as PreparedAttachment;
    setAttachments((current) => current.map((item) => item.localId === attachment.localId
      ? { ...item, state: 'uploading', error: undefined }
      : item));
    try {
      const uploaded = await uploadAttachment({
        localId: attachment.localId,
        serverId: attachment.serverId,
        name: attachment.name,
        uri: attachment.uri,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size ?? 0,
        state: 'uploading',
      }, chatId);
      const ready: PreparedAttachment = {
        ...attachment,
        serverId: uploaded.id,
        mimeType: uploaded.mimeType,
        kind: attachmentKind(uploaded.mimeType),
        state: 'ready',
        error: undefined,
      };
      setAttachments((current) => current.map((item) => item.localId === attachment.localId ? ready : item));
      return ready;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setAttachments((current) => current.map((item) => item.localId === attachment.localId
        ? { ...item, state: 'failed', error: message }
        : item));
      return null;
    }
  }, [chatId]);

  const retryAttachment = useCallback((localId: string) => {
    const attachment = attachments.find((item) => item.localId === localId);
    if (attachment && attachment.state !== 'uploading') void uploadOne(attachment);
  }, [attachments, uploadOne]);

  const removeComposerAttachment = useCallback((localId: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.localId === localId);
      if (messageEdit && target?.serverId && !messageEdit.originalAttachmentIds.has(target.serverId)) {
        void deleteUnreferencedAttachment(target.serverId).catch(() => undefined);
      }
      return current.filter((attachment) => attachment.localId !== localId);
    });
    Haptics.selectionAsync();
  }, [messageEdit]);

  const submitMessage = useCallback(async () => {
    if (sending || attachments.some((attachment) => attachment.state === 'uploading')) return;
    setSending(true);
    let followSnapshot: ChatFollowSnapshot | null = null;
    try {
      const prepared = await Promise.all(attachments.map(uploadOne));
      if (prepared.some((attachment) => attachment === null)) {
        Alert.alert('Some files couldn’t upload', 'Retry or remove the failed files, then send again.');
        return;
      }
      if (messageEdit) {
        const accepted = await onEdit(
          messageEdit.message,
          input.trim(),
          prepared as PreparedAttachment[],
          activeAgentEnabled,
        );
        if (accepted) restoreComposer();
        return;
      }
      // Arm before invoking onSend: it inserts the optimistic rows before its
      // first network await, so arming after the promise resolves is too late.
      followSnapshot = armSubmittedTurnFollow();
      const accepted = await onSend(input, prepared as PreparedAttachment[], { presetSelections, agentEnabled: activeAgentEnabled, temporary });
      if (!accepted) {
        restoreSubmittedTurnFollow(followSnapshot);
        followSnapshot = null;
        return;
      }
      followSnapshot = null;
      onChangeInput('');
      setAttachments([]);
    } catch (error) {
      if (followSnapshot) restoreSubmittedTurnFollow(followSnapshot);
      Alert.alert('Couldn’t send message', error instanceof Error ? error.message : 'Your draft was kept. Please try again.');
    } finally {
      setSending(false);
    }
  }, [activeAgentEnabled, armSubmittedTurnFollow, attachments, input, messageEdit, onChangeInput, onEdit, onSend, presetSelections, restoreComposer, restoreSubmittedTurnFollow, sending, temporary, uploadOne]);

  const submitSuggestion = useCallback((message: string) => {
    const followSnapshot = armSubmittedTurnFollow();
    void onSend(message, [], { presetSelections, agentEnabled: activeAgentEnabled, temporary }).then((accepted) => {
      if (!accepted) restoreSubmittedTurnFollow(followSnapshot);
    }).catch((error) => {
      restoreSubmittedTurnFollow(followSnapshot);
      Alert.alert('Couldn’t send message', error instanceof Error ? error.message : undefined);
    });
  }, [activeAgentEnabled, armSubmittedTurnFollow, onSend, presetSelections, restoreSubmittedTurnFollow, temporary]);

  const nativeAgentTint = colorScheme === 'dark' ? '#BF5AF2' : '#AF52DE';
  const nativeAgentForeground = activeAgentEnabled ? '#ffffff' : colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e';

  const updateBottomProximity = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearBottom = isNearChatBottom({
      offsetY: contentOffset.y,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
    });
    isNearBottom.current = nearBottom;
    // A newly selected chat initially reports offset zero before its rows have
    // finished measuring. Do not interpret that transient position as the
    // reader intentionally leaving the tail.
    if (chatTailPending.current) {
      return;
    }
    if (!readerInteracting.current) shouldAutoFollow.current = nearBottom;
  }, []);

  const cancelPendingFollow = useCallback(() => {
    if (pendingFollowFrame.current === null) return;
    cancelAnimationFrame(pendingFollowFrame.current);
    pendingFollowFrame.current = null;
  }, []);

  const cancelTailSettle = useCallback(() => {
    if (tailSettleTimer.current === null) return;
    clearTimeout(tailSettleTimer.current);
    tailSettleTimer.current = null;
  }, []);

  const scrollToMeasuredTail = useCallback((animated: boolean) => {
    // scrollToEnd relies on VirtualizedList's last-cell estimate, which can be
    // stale for one very tall native Markdown row. The measured content height
    // is clamped by the native scroll view and reliably reaches the real tail.
    listRef.current?.scrollToOffset({ animated, offset: measuredContentHeight.current });
  }, []);

  const scheduleTailSettle = useCallback(() => {
    cancelTailSettle();
    // Static native Markdown can publish its final intrinsic height a frame or
    // two after FlatList's first measurement. Wait for a short quiet window,
    // then establish the true tail (including meta and branch controls).
    tailSettleTimer.current = setTimeout(() => {
      tailSettleTimer.current = null;
      if (!chatTailPending.current || readerInteracting.current) return;
      scrollToMeasuredTail(false);
      chatTailPending.current = false;
      isNearBottom.current = true;
      shouldAutoFollow.current = true;
    }, 180);
  }, [cancelTailSettle, scrollToMeasuredTail]);

  const beginReaderInteraction = useCallback(() => {
    submittedTurnFollowRevision.current += 1;
    readerInteracting.current = true;
    chatTailPending.current = false;
    shouldAutoFollow.current = false;
    cancelPendingFollow();
    cancelTailSettle();
  }, [cancelPendingFollow, cancelTailSettle]);

  const endReaderInteraction = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    readerInteracting.current = false;
    updateBottomProximity(event);
    shouldAutoFollow.current = isNearBottom.current;
  }, [updateBottomProximity]);

  const followContentIfNeeded = useCallback(() => {
    const establishingChatTail = chatTailPending.current;
    if (!shouldFollowChatContent(
      shouldAutoFollow.current && isNearBottom.current,
      readerInteracting.current,
      establishingChatTail,
    ) || pendingFollowFrame.current !== null) return;
    pendingFollowFrame.current = requestAnimationFrame(() => {
      pendingFollowFrame.current = null;
      if (!shouldFollowChatContent(
        shouldAutoFollow.current && isNearBottom.current,
        readerInteracting.current,
        chatTailPending.current,
      )) return;
      scrollToMeasuredTail(chatTailPending.current ? false : assistantStatus === 'idle');
    });
  }, [assistantStatus, scrollToMeasuredTail]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    measuredContentHeight.current = height;
    followContentIfNeeded();
    if (!chatTailPending.current) return;
    scheduleTailSettle();
  }, [followContentIfNeeded, scheduleTailSettle]);

  useEffect(() => {
    submittedTurnFollowRevision.current += 1;
    isNearBottom.current = true;
    shouldAutoFollow.current = true;
    readerInteracting.current = false;
    chatTailPending.current = true;
    measuredContentHeight.current = 0;
    cancelPendingFollow();
    scheduleTailSettle();
  }, [cancelPendingFollow, chatId, scheduleTailSettle]);

  useEffect(() => () => {
    cancelPendingFollow();
    cancelTailSettle();
  }, [cancelPendingFollow, cancelTailSettle]);

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <MessageRow
      message={item}
      model={responseModel(item, models, model)}
      onEdit={expired ? () => Alert.alert('Temporary chat expired', 'This conversation is read-only.') : handleMessageEditAction}
      onRegenerate={expired ? () => Alert.alert('Temporary chat expired', 'This conversation is read-only.') : onRegenerate}
      onActivateBranch={expired
        ? async () => { Alert.alert('Temporary chat expired', 'This conversation is read-only.'); }
        : onActivateBranch}
      editingLocked={Boolean(messageEdit)}
    />
  ), [expired, handleMessageEditAction, messageEdit, model, models, onActivateBranch, onRegenerate]);

  const empty = isEmptyConversation && assistantStatus === 'idle';
  const headerAction = resolveChatHeaderAction(chatId, messages.length, temporary);
  const headerExpansionProgress = useSharedValue(headerAction === 'temporary-actions' ? 1 : 0);
  const modelTriggerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(headerExpansionProgress.value, [0, 1], [22, 0]) }],
  }));
  const loadingExistingChat = Boolean(chatId && isEmptyConversation && !chatLoaded);
  const hasPendingAssistant = messages.some((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'));
  const canSend = Boolean(model.id)
    && (input.trim().length > 0 || attachments.length > 0)
    && assistantStatus === 'idle'
    && !sending
    && !expired
    && !(attachments.some((attachment) => attachment.kind === 'file') && (!activeAgentEnabled || !canUseAgent))
    && !attachments.some((attachment) => attachment.state === 'uploading');

  useEffect(() => {
    const target = headerAction === 'temporary-actions' ? 1 : 0;
    headerExpansionProgress.value = reduceMotion
      ? target
      : withSpring(target, { damping: 18, stiffness: 220, mass: 0.8 });
  }, [headerAction, headerExpansionProgress, reduceMotion]);

  const emptyLandingContent = (
    <View style={styles.emptyState}>
      <Reanimated.View style={[styles.emptyIdentity, emptyStateAnimatedStyle]}>
        <View style={styles.emptyModelLineWrap}>
          <Reanimated.View
            accessibilityElementsHidden={!temporary}
            accessibilityLabel="Temporary chat"
            pointerEvents="none"
            style={[styles.temporaryLabel, temporaryLabelAnimatedStyle]}
          >
            <Ghost color={colorScheme === 'dark' ? '#c4b5fd' : '#6d28d9'} size={14} strokeWidth={2} />
            <Text style={[styles.temporaryLabelText, colorScheme === 'dark' && styles.temporaryLabelTextDark]}>Temporary</Text>
          </Reanimated.View>
          <View style={[styles.emptyModelLine, accessibilityLayout && styles.emptyModelLineAccessible]}>
            <ModelMark model={model} size={48} />
            <Text maxFontSizeMultiplier={1.6} style={styles.emptyTitle}>{model.name}</Text>
          </View>
        </View>
        <Text maxFontSizeMultiplier={1.6} style={styles.emptyProvider}>{model.lab}</Text>
      </Reanimated.View>
      <Reanimated.View style={[styles.suggestionReveal, suggestionsAnimatedStyle]}>
        <View
          onLayout={(event) => {
            suggestionGridHeight.value = Math.max(suggestionGridHeight.value, event.nativeEvent.layout.height);
          }}
          style={[styles.suggestionGrid, accessibilityLayout && styles.suggestionGridAccessible]}
        >
          {suggestions.map((suggestion, index) => (
            <SuggestedPromptButton
              accessible={accessibilityLayout}
              key={`${suggestion.id}:${index}`}
              label={suggestion.label}
              onPress={() => submitSuggestion(suggestion.message)}
              temporary={temporary}
            />
          ))}
        </View>
      </Reanimated.View>
    </View>
  );

  return (
    <Reanimated.View style={[styles.chatRoot, temporarySurfaceAnimatedStyle]}>
      <View
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          setHeaderOverlayHeight((current) => current === height ? current : height);
        }}
        pointerEvents="box-none"
        style={[styles.chatHeaderOverlay, { paddingTop: insets.top }]}
      >
        {/* Header */}
        <AppHeader>
          {persistentSidebar
            ? <View accessibilityElementsHidden importantForAccessibility="no" style={styles.headerButtonPlaceholder} />
            : <RoundButton icon="line.3.horizontal" accessibilityLabel="Open chats" onPress={onOpenPanel} selected={temporary} />}
          <Reanimated.View style={[styles.modelTriggerWrap, modelTriggerAnimatedStyle]}>
            {Platform.OS === 'ios' && !accessibilityLayout ? (
              <NativeModelMenu model={model} models={models} onSelectModel={onSelectModel} temporary={temporary} />
            ) : (
              <Pressable
                accessibilityHint="Opens the model picker"
                accessibilityLabel={`Model, ${model.name}`}
                accessibilityRole="button"
                onPress={onOpenModelPicker}
              >
                <Glass
                  interactive
                  style={styles.modelTrigger}
                  tintColor={temporary ? colorScheme === 'dark' ? 'rgba(88,28,135,0.32)' : 'rgba(175,82,222,0.16)' : undefined}
                >
                  <ModelMark model={model} size={22} logo="lab" />
                  <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.modelTriggerText}>{model.name}</Text>
                </Glass>
              </Pressable>
            )}
          </Reanimated.View>
          <Reanimated.View
            style={styles.headerActionExpanded}
          >
            {headerAction === 'temporary-toggle' ? (
              <TemporaryChatHeaderControl
                active={temporary}
                expanded={false}
                onToggleTemporary={() => {
                  onTemporaryChange(!temporary);
                  Haptics.selectionAsync();
                }}
                onNewChat={onNewChat}
                onSave={onSaveTemporary}
                saveDisabled={expired}
                saving={savingTemporary}
              />
            ) : headerAction === 'temporary-actions' ? (
              <TemporaryChatHeaderControl
                active
                expanded
                onToggleTemporary={() => onTemporaryChange(false)}
                onNewChat={onNewChat}
                onSave={onSaveTemporary}
                saveDisabled={expired}
                saving={savingTemporary}
              />
            ) : (
              <RoundButton icon="square.and.pencil" accessibilityLabel="New chat" onPress={onNewChat} />
            )}
          </Reanimated.View>
        </AppHeader>

        {showConnectionBanner && (
          <View style={[styles.connectionBanner, (connectionState === 'offline' || syncError) && styles.connectionBannerOffline]}>
            <Icon name={syncError ? 'exclamationmark.triangle' : connectionState === 'offline' ? 'wifi.slash' : 'arrow.triangle.2.circlepath'} size={12} color={connectionState === 'offline' || syncError ? COLORS.warning : COLORS.muted} />
            <Text style={styles.connectionBannerText}>{syncError ?? (connectionState === 'offline' ? 'Offline · messages will send when Pulpo reconnects' : 'Reconnecting to Pulpo…')}</Text>
          </View>
        )}
        {expired && (
          <View accessibilityRole="alert" style={[styles.connectionBanner, styles.temporaryExpiredBanner]}>
            <Icon name="clock.badge.xmark" size={12} color="#8B5CF6" />
            <Text style={styles.connectionBannerText}>This temporary chat expired and is now read-only.</Text>
          </View>
        )}

      </View>

      {loadingExistingChat ? (
        <View
          accessibilityLabel="Loading conversation"
          accessibilityRole="progressbar"
          style={[styles.emptyConversation, styles.chatContent, { paddingHorizontal: horizontalPadding, paddingTop: headerOverlayHeight + 16 }]}
        >
          <ActivityIndicator color={COLORS.muted} />
        </View>
      ) : empty ? (
        accessibilityLayout ? (
          <ScrollView
            alwaysBounceVertical
            contentContainerStyle={[styles.emptyConversationAccessible, { paddingHorizontal: horizontalPadding, paddingTop: headerOverlayHeight + 16 }]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onTouchStart={Keyboard.dismiss}
            showsVerticalScrollIndicator={false}
            style={[styles.flex, styles.chatContent]}
          >
            {emptyLandingContent}
          </ScrollView>
        ) : (
          // Normal-size landing stays outside a scroll view so keyboard focus
          // cannot retain a stale offset and clip the identity.
          <View onTouchStart={Keyboard.dismiss} style={[styles.emptyConversation, styles.chatContent, { paddingHorizontal: horizontalPadding, paddingTop: headerOverlayHeight + 16 }]}>
            {emptyLandingContent}
          </View>
        )
      ) : (
        /* The full-screen transcript scrolls beneath the transparent status/header overlay. */
        <FlatList
          alwaysBounceVertical
          bounces
          contentContainerStyle={[styles.conversation, styles.chatContent, { paddingHorizontal: horizontalPadding, paddingTop: headerOverlayHeight + 16 }]}
          contentInsetAdjustmentBehavior="never"
          data={messages}
          initialNumToRender={10}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          key={chatId ?? 'unsaved-chat'}
          keyExtractor={(message) => message.id}
          ListFooterComponent={assistantStatus === 'thinking' && !hasPendingAssistant ? (
            <View accessibilityLiveRegion="polite" style={styles.assistantRow}>
              <View style={styles.assistantHeader}>
                <ModelMark model={model} size={26} />
                <Text style={styles.assistantName}>{model.name}</Text>
                <Text style={styles.messageTime}>now</Text>
              </View>
              <ResponsePendingIndicator />
            </View>
          ) : streamingSession ? (
            <StreamingResponse key={streamingSession.id} model={model} onComplete={onStreamingComplete} session={streamingSession} />
          ) : null}
          onContentSizeChange={handleContentSizeChange}
          onMomentumScrollBegin={beginReaderInteraction}
          onMomentumScrollEnd={endReaderInteraction}
          onScroll={updateBottomProximity}
          onScrollBeginDrag={beginReaderInteraction}
          onScrollEndDrag={endReaderInteraction}
          onTouchStart={Keyboard.dismiss}
          ref={listRef}
          renderItem={renderMessage}
          renderScrollComponent={renderChatScrollComponent}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.flex}
        />
      )}

      <KeyboardStickyView enabled={keyboardLayoutEnabled} offset={keyboardOffset} style={styles.composerSticky}>
        <View style={[styles.composerWrap, styles.chatContent, { paddingHorizontal: Math.max(12, horizontalPadding - 6), paddingBottom: Math.max(insets.bottom, 10) }]}>
            <Glass
              interactive
              style={styles.composer}
              tintColor={temporary ? colorScheme === 'dark' ? 'rgba(88,28,135,0.32)' : 'rgba(175,82,222,0.16)' : undefined}
            >
              {messageEdit ? (
                <View style={styles.messageEditBanner}>
                  <Icon name="pencil" size={12} color={COLORS.muted} />
                  <Text style={styles.messageEditBannerText}>Editing message</Text>
                  <Pressable accessibilityLabel="Cancel message edit" accessibilityRole="button" disabled={sending} onPress={cancelMessageEdit}>
                    <Text style={styles.messageEditCancel}>Cancel</Text>
                  </Pressable>
                </View>
              ) : null}
              <AttachmentStrip
                attachments={attachments}
                onRetry={retryAttachment}
                onRemove={removeComposerAttachment}
              />
              {attachments.some((attachment) => attachment.kind === 'file') && (!activeAgentEnabled || !canUseAgent) ? (
                <Text accessibilityRole="alert" style={styles.attachmentRestrictionText}>
                  {!canUseAgent ? 'Choose an Agent-capable model or remove non-image files.' : 'Turn on Agent mode to use non-image files.'}
                </Text>
              ) : null}
              <TextInput
                ref={composerInputRef}
                accessibilityLabel="Message"
                autoFocus
                maxFontSizeMultiplier={1.6}
                multiline
                maxLength={1_000_000}
                onChangeText={onChangeInput}
                placeholder={attachments.length > 0 ? 'Add a caption…' : messageEdit ? 'Edit message…' : temporary ? 'Temporary message…' : 'Message…'}
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={input}
              />
              <View style={styles.composerBar}>
                {Platform.OS === 'ios' ? (
                  <NativeAttachmentMenu onTakePhoto={takePhoto} onPickFiles={pickFiles} onPickPhotos={pickPhotos} />
                ) : (
                  <Pressable
                    accessibilityLabel="Add attachment"
                    accessibilityRole="button"
                    onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                    style={({ pressed }) => [styles.composerCircle, pressed && styles.pressed]}
                  >
                    <Icon name="plus" size={16} />
                  </Pressable>
                )}
                {hasGenerationPresets && (Platform.OS === 'ios' ? (
                  <SwiftUIHost ignoreSafeArea="keyboard" matchContents style={styles.effortMenuHost}>
                    <SwiftUIMenu
                      label={presetLabel}
                      modifiers={[
                        buttonStyle('glass'),
                        buttonBorderShape('capsule'),
                        controlSize('regular'),
                        swiftUIAccessibilityLabel(`Generation options, ${presetLabel}`),
                        swiftUIAccessibilityHint('Opens chat preset choices'),
                      ]}
                    >
                      {(prototypeModel?.presets ?? []).map((preset) => (
                        <SwiftUISection key={preset.id} title={preset.name}>
                          {preset.choices.map((choice) => (
                            <SwiftUIButton
                              key={choice.id}
                              label={choice.label}
                              systemImage={choice.id === presetSelections[preset.id] ? 'checkmark' : undefined}
                              onPress={() => onSelectPreset(preset.id, choice.id)}
                            />
                          ))}
                        </SwiftUISection>
                      ))}
                    </SwiftUIMenu>
                  </SwiftUIHost>
                ) : (
                  <Pressable
                    accessibilityHint="Opens chat preset choices"
                    accessibilityLabel={`Generation options, ${presetLabel}`}
                    accessibilityRole="button"
                    onPress={openPresetPicker}
                    style={({ pressed }) => [styles.effortPill, pressed && styles.pressed]}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.effortText}>{presetLabel}</Text>
                  </Pressable>
                ))}
                <View style={styles.flex} />
                {Platform.OS === 'ios' ? (
                  <>
                    <SwiftUIHost ignoreSafeArea="keyboard" style={styles.nativeAgentHost}>
                      <SwiftUIButton
                        onPress={() => {
                          toggleAgent();
                        }}
                        modifiers={[
                          buttonStyle(activeAgentEnabled ? 'glassProminent' : 'glass'),
                          buttonBorderShape('circle'),
                          controlSize('regular'),
                          tint(nativeAgentTint),
                          swiftUIDisabled(!canUseAgent),
                          swiftUIAccessibilityLabel('Agent mode'),
                          swiftUIAccessibilityHint(!agentAvailable ? 'Unavailable on this Pulpo instance.' : !model.agentEnabled ? 'Unavailable for this model.' : activeAgentEnabled ? 'On. Double tap to turn off.' : 'Off. Double tap to turn on.'),
                        ]}
                      >
                        <SwiftUIRNHostView matchContents>
                          <View pointerEvents="none" style={styles.nativeAgentIcon}>
                            <Bot color={nativeAgentForeground} size={13} strokeWidth={2} />
                          </View>
                        </SwiftUIRNHostView>
                      </SwiftUIButton>
                    </SwiftUIHost>
                    <NativeComposerIconButton
                      disabled={assistantStatus === 'idle' && !canSend}
                      label={assistantStatus !== 'idle' ? 'Stop generating' : messageEdit ? 'Save and resend message' : 'Send message'}
                      onPress={() => assistantStatus !== 'idle' ? onStop() : submitMessage()}
                      prominent
                      systemImage={assistantStatus !== 'idle' ? 'stop.fill' : 'arrow.up'}
                    />
                  </>
                ) : (
                  <>
                    <Pressable
                      accessibilityLabel="Agent mode"
                      accessibilityRole="switch"
                      accessibilityState={{ checked: activeAgentEnabled }}
                      disabled={!canUseAgent}
                      onPress={toggleAgent}
                      style={({ pressed }) => [styles.agentCircle, activeAgentEnabled && styles.agentCircleActive, pressed && styles.pressed]}
                    >
                      <Bot color={activeAgentEnabled ? COLORS.foregroundOnAccent : COLORS.muted} size={13} strokeWidth={2} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={assistantStatus !== 'idle' ? 'Stop generating' : messageEdit ? 'Save and resend message' : 'Send message'}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: assistantStatus === 'idle' && !canSend }}
                      disabled={assistantStatus === 'idle' && !canSend}
                      onPress={() => assistantStatus !== 'idle' ? onStop() : submitMessage()}
                      style={({ pressed }) => [styles.sendButton, assistantStatus === 'idle' && !canSend && styles.disabledButton, pressed && styles.pressed]}
                    >
                      <Icon
                        name={assistantStatus !== 'idle' ? 'stop.fill' : 'arrow.up'}
                        size={14}
                        color={COLORS.foregroundOnAccent}
                        weight="bold"
                      />
                    </Pressable>
                  </>
                )}
              </View>
            </Glass>
        </View>
      </KeyboardStickyView>
      <GenerationPresetSheet
        model={prototypeModel}
        selections={presetSelections}
        visible={presetPickerOpen}
        onClose={() => setPresetPickerOpen(false)}
        onSelect={onSelectPreset}
      />
    </Reanimated.View>
  );
}

function GenerationPresetSheet({
  visible,
  model,
  selections,
  onClose,
  onSelect,
}: {
  visible: boolean;
  model?: PrototypeModel;
  selections: GenerationSelections;
  onClose: () => void;
  onSelect: (presetId: string, choiceId: string) => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.optionModal}>
        <Pressable accessibilityLabel="Close generation options" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.optionSheet}>
          <Text accessibilityRole="header" style={styles.optionTitle}>Generation options</Text>
          <Text style={styles.optionSubtitle}>Choose this model’s chat presets.</Text>
          {(model?.presets ?? []).map((preset) => (
            <View key={preset.id}>
              <Text style={styles.sheetSection}>{preset.name.toUpperCase()}</Text>
              {preset.choices.map((choice) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: choice.id === selections[preset.id] }}
                  key={choice.id}
                  onPress={() => onSelect(preset.id, choice.id)}
                  style={({ pressed }) => [styles.optionRow, pressed && styles.navRowPressed]}
                >
                  <Text style={styles.optionRowText}>{choice.label}</Text>
                  {choice.id === selections[preset.id] && <Icon name="checkmark" size={16} color={COLORS.accent} weight="semibold" />}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function NativeDrawerSearch({ value, focused, onChange, onFocusChange, fieldRef }: { value: string; focused: boolean; onChange: (value: string) => void; onFocusChange: (focused: boolean) => void; fieldRef: RefObject<SwiftUITextFieldRef | null> }) {
  const nativeValue = useNativeState(value);
  useEffect(() => { if (nativeValue.get() !== value) nativeValue.set(value); }, [nativeValue, value]);

  if (!focused && value.length === 0) {
    return <SwiftUIHost style={styles.nativeDrawerSearchHost}>
      <SwiftUIButton
        onPress={() => {
          onFocusChange(true);
          requestAnimationFrame(() => { void fieldRef.current?.focus(); });
        }}
        modifiers={[buttonStyle('plain'), swiftUIAccessibilityLabel('Search chats')]}
      >
        <SwiftUIHStack spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: DRAWER_ACTION_HEIGHT }), contentShape(shapes.rectangle())]}>
          <SwiftUIImage systemName="magnifyingglass" size={17} modifiers={[frame({ width: 20, height: 20 }), foregroundStyle('primary')]} />
          <SwiftUIText modifiers={[font({ textStyle: 'body' }), foregroundStyle('primary')]}>Search chats</SwiftUIText>
          <SwiftUISpacer />
        </SwiftUIHStack>
      </SwiftUIButton>
    </SwiftUIHost>;
  }

  return <SwiftUIHost style={styles.nativeDrawerSearchHost}>
    <SwiftUIHStack spacing={12}>
      <SwiftUIImage systemName="magnifyingglass" size={17} modifiers={[frame({ width: 20, height: 20 }), foregroundStyle('primary')]} />
      <SwiftUITextField ref={fieldRef} placeholder="Search chats" text={nativeValue} onFocusChange={onFocusChange} onTextChange={onChange} modifiers={[textFieldStyle('plain'), font({ textStyle: 'body' }), frame({ maxWidth: Infinity, minHeight: 44 }), swiftUIAccessibilityLabel('Search chats')]} />
      {value.length > 0 ? <SwiftUIButton label="Clear search" systemImage="xmark.circle.fill" onPress={() => { nativeValue.set(''); onChange(''); }} modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), frame({ width: 44, height: 44 }), swiftUIAccessibilityLabel('Clear search')]} /> : null}
    </SwiftUIHStack>
  </SwiftUIHost>;
}

function NativeDrawerAction({ icon, label, value, onPress }: { icon: NativeButtonSystemImage; label: string; value?: string; onPress: () => void }) {
  return <SwiftUIHost style={styles.nativeDrawerActionHost}>
    <SwiftUIButton onPress={onPress} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), swiftUIAccessibilityLabel(value ? `${label}, ${value}` : label)]}>
      <SwiftUIHStack spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 46 }), contentShape(shapes.rectangle())]}><SwiftUIImage systemName={icon} size={17} modifiers={[frame({ width: 20, height: 20 })]} /><SwiftUIText>{label}</SwiftUIText><SwiftUISpacer />{value ? <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{value}</SwiftUIText> : null}</SwiftUIHStack>
    </SwiftUIButton>
  </SwiftUIHost>;
}

function NativeFoldersDisclosure({ folders, onCreate, onSelectChat }: {
  folders: Array<{ id: string; name: string; chats: HistoryChatSummary[] }>;
  onCreate: () => void;
  onSelectChat: (chat: HistoryChatSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const { reduceMotion } = useAccessibilityPreferences();
  const entering = reduceMotion ? undefined : FadeInUp.duration(200);
  const exiting = reduceMotion ? undefined : FadeOutUp.duration(150);
  const layout = reduceMotion ? undefined : LinearTransition.duration(200);
  return <Reanimated.View layout={layout} style={styles.nativeFoldersDisclosureHost}>
    <SwiftUIHost ignoreSafeArea="all" style={styles.nativeFoldersHeaderHost}>
      <SwiftUIContextMenu>
        <SwiftUIContextMenu.Trigger>
          <SwiftUIButton onPress={() => { Haptics.selectionAsync(); setExpanded((current) => !current); }} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), swiftUIAccessibilityLabel(`Folders, ${folders.length}, ${expanded ? 'expanded' : 'collapsed'}`)]}>
            <SwiftUIHStack spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: DRAWER_ACTION_HEIGHT }), contentShape(shapes.rectangle())]}>
              <SwiftUIImage systemName={expanded ? 'folder.fill' : 'folder'} size={17} modifiers={[frame({ width: 20, height: 20 })]} />
              <SwiftUIText>Folders</SwiftUIText>
              <SwiftUISpacer />
              <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{String(folders.length)}</SwiftUIText>
            </SwiftUIHStack>
          </SwiftUIButton>
        </SwiftUIContextMenu.Trigger>
        <SwiftUIContextMenu.Items><SwiftUIButton label="New folder" systemImage="folder.badge.plus" onPress={onCreate} /><SwiftUIButton label="Manage folders" systemImage="folder" onPress={() => Alert.alert('Manage folders')} /><SwiftUIDivider /><SwiftUIButton label="Sort folders" systemImage="arrow.up.arrow.down" onPress={() => Alert.alert('Sort folders')} /></SwiftUIContextMenu.Items>
      </SwiftUIContextMenu>
    </SwiftUIHost>
    {expanded ? <Reanimated.View entering={entering} exiting={exiting} layout={layout} style={styles.nativeFoldersContent}>
      {folders.map((folder) => {
        const folderExpanded = expandedFolders[folder.id] ?? false;
        return <Reanimated.View key={folder.id} layout={layout} style={styles.nativeFolderGroup}>
          <SwiftUIHost ignoreSafeArea="all" style={styles.nativeFolderRowHost}>
            <SwiftUIButton onPress={() => { Haptics.selectionAsync(); setExpandedFolders((current) => ({ ...current, [folder.id]: !folderExpanded })); }} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), swiftUIAccessibilityLabel(`${folder.name}, ${folder.chats.length} chats, ${folderExpanded ? 'expanded' : 'collapsed'}`)]}>
              <SwiftUIHStack spacing={10} modifiers={[padding({ leading: 24 }), frame({ maxWidth: Infinity, minHeight: 40 }), contentShape(shapes.rectangle())]}>
                <SwiftUIImage systemName={folderExpanded ? 'folder.fill' : 'folder'} size={15} modifiers={[frame({ width: 20, height: 20 }), foregroundStyle('secondary')]} />
                <SwiftUIText>{folder.name}</SwiftUIText>
                <SwiftUISpacer />
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{String(folder.chats.length)}</SwiftUIText>
              </SwiftUIHStack>
            </SwiftUIButton>
          </SwiftUIHost>
          {folderExpanded ? <Reanimated.View entering={entering} exiting={exiting} layout={layout} style={styles.nativeFoldersContent}>
            {folder.chats.length > 0 ? folder.chats.map((chat) =>
              <SwiftUIHost ignoreSafeArea="all" key={chat.id} style={styles.nativeFolderChatRowHost}>
                <SwiftUIButton onPress={() => onSelectChat(chat)} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), swiftUIAccessibilityLabel(`Open ${chat.title}`)]}>
                  <SwiftUIHStack spacing={10} modifiers={[padding({ leading: 48 }), frame({ maxWidth: Infinity, minHeight: 38 }), contentShape(shapes.rectangle())]}><SwiftUIImage systemName="bubble.left" size={14} modifiers={[frame({ width: 20, height: 20 }), foregroundStyle('secondary')]} /><SwiftUIText>{chat.title}</SwiftUIText><SwiftUISpacer /></SwiftUIHStack>
                </SwiftUIButton>
              </SwiftUIHost>
            ) : <SwiftUIHost ignoreSafeArea="all" style={styles.nativeFolderEmptyRowHost}><SwiftUIHStack modifiers={[padding({ leading: 78 }), frame({ maxWidth: Infinity, minHeight: 34 })]}><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>No chats yet</SwiftUIText><SwiftUISpacer /></SwiftUIHStack></SwiftUIHost>}
          </Reanimated.View> : null}
        </Reanimated.View>;
      })}
      <SwiftUIHost ignoreSafeArea="all" style={styles.nativeFolderRowHost}>
        <SwiftUIButton onPress={onCreate} modifiers={[buttonStyle('plain'), foregroundStyle('secondary'), swiftUIAccessibilityLabel('New folder')]}>
          <SwiftUIHStack spacing={10} modifiers={[padding({ leading: 24 }), frame({ maxWidth: Infinity, minHeight: 40 }), contentShape(shapes.rectangle())]}><SwiftUIImage systemName="folder.badge.plus" size={15} modifiers={[frame({ width: 20, height: 20 })]} /><SwiftUIText>New folder</SwiftUIText><SwiftUISpacer /></SwiftUIHStack>
        </SwiftUIButton>
      </SwiftUIHost>
    </Reanimated.View> : null}
  </Reanimated.View>;
}

type HistoryChatAction = HistoryChatContextMenuAction;
const DEFAULT_HISTORY_PREVIEW = 'Start a new conversation with your selected model.';

const HistoryChatRow = memo(function HistoryChatRow({ active, chat, previewText, removeChatLabel, onChatAction, onOpenActions, onSelectChat }: {
  active: boolean;
  chat: HistoryChatSummary;
  previewText: string;
  removeChatLabel: string;
  onChatAction: (chat: HistoryChatSummary, action: HistoryChatAction) => void;
  onOpenActions: (chat: HistoryChatSummary) => void;
  onSelectChat: (chat: HistoryChatSummary) => void;
}) {
  const rowContent = <>
    <View style={styles.flex}>
      <Text numberOfLines={1} style={styles.chatTitle}>{chat.title}</Text>
    </View>
    <Text style={styles.chatTime}>{chat.time}</Text>
  </>;
  if (Platform.OS === 'ios') return (
    <HistoryChatContextMenuView
      accessibilityLabel={chat.title}
      accessibilityHint="Double tap to open. Long press for more actions."
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      pinned={chat.pinned}
      removeChatLabel={removeChatLabel}
      previewTitle={chat.title}
      previewBody={previewText}
      previewMetadata={`${chat.section} · ${chat.time}`}
      previewImageURI={PULPO_MARK_URI}
      onAction={(action) => onChatAction(chat, action)}
      onPress={() => onSelectChat(chat)}
      style={styles.chatContextMenuHost}
    >
      <View pointerEvents="none" style={[styles.chatRow, active && styles.chatRowActive]}>
        {rowContent}
      </View>
    </HistoryChatContextMenuView>
  );
  return (
    <Pressable
      accessibilityHint="Double tap to open. Long press for more actions."
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      delayLongPress={350}
      onLongPress={() => onOpenActions(chat)}
      onPress={() => onSelectChat(chat)}
      style={({ pressed }) => [styles.chatRow, active && styles.chatRowActive, pressed && styles.navRowPressed]}
    >
      {rowContent}
    </Pressable>
  );
});

const HistoryPanel = memo(function HistoryPanel({ chats, activeChatId, drawerOpen, loading, persistent, onSelectChat, onNewChat, onOpenSettings }: {
  chats: HistoryChatSummary[];
  activeChatId: string | null;
  drawerOpen: boolean;
  loading: boolean;
  persistent: boolean;
  onSelectChat: (chat: HistoryChatSummary) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}) {
  const insets = useSafeAreaInsets();
  const folders = usePrototypeStore((state) => state.folders);
  const trashChat = usePrototypeStore((state) => state.trashChat);
  const trashRetention = usePrototypeStore((state) => state.preferences.trashRetention);
  const togglePin = usePrototypeStore((state) => state.togglePin);
  const renameChat = usePrototypeStore((state) => state.renameChat);
  const moveChat = usePrototypeStore((state) => state.moveChat);
  const upsertChat = usePrototypeStore((state) => state.upsertChat);
  const addFolder = usePrototypeStore((state) => state.addFolder);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const folderItems = useMemo(() => {
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      chats: chats.filter((chat) => chat.folderId === folder.id),
    }));
  }, [chats, folders]);
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const searchQueryProgress = useSharedValue(search.length > 0 ? 1 : 0);
  const nativeSearchRef = useRef<SwiftUITextFieldRef>(null);
  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    void nativeSearchRef.current?.blur();
  }, []);
  useEffect(() => {
    if (!drawerOpen && !persistent) dismissSearch();
  }, [dismissSearch, drawerOpen, persistent]);
  useEffect(() => {
    searchQueryProgress.value = withTiming(search.length > 0 ? 1 : 0, { duration: 180 });
  }, [search, searchQueryProgress]);
  const searchActionsAnimatedStyle = useAnimatedStyle(() => {
    const collapseProgress = Math.max(keyboardProgress.value, searchQueryProgress.value);
    return {
      maxHeight: interpolate(collapseProgress, [0, 1], [1000, 0]),
      opacity: interpolate(collapseProgress, [0, 0.72], [1, 0]),
      overflow: 'hidden',
      transform: [{ translateY: interpolate(collapseProgress, [0, 1], [0, -DRAWER_ACTION_HEIGHT]) }],
    };
  });
  const filtered = useMemo(
    () => chats.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase())),
    [chats, search],
  );
  const sections = useMemo(() => {
    const grouped = new Map<string, HistoryChatSummary[]>();
    filtered.forEach((chat) => grouped.set(chat.section, [...(grouped.get(chat.section) ?? []), chat]));
    return Array.from(grouped, ([title, data]) => ({ title, data }));
  }, [filtered]);
  const { label: removeChatLabel, requiresConfirmation } = chatRemovalBehavior(trashRetention);

  const runChatAction = useCallback((chat: HistoryChatSummary, action: HistoryChatAction) => {
    if (action === 'delete') {
      if (!requiresConfirmation) {
        Haptics.selectionAsync();
        trashChat(chat.id);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Delete chat?', `“${chat.title}” will be removed from your history.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => trashChat(chat.id) },
      ]);
      return;
    }
    Haptics.selectionAsync();
    if (action === 'share') {
      void shareServerChat(chat.id).then((url) => Share.share({ message: `${chat.title}\n\n${url}`, url })).catch((error) => Alert.alert('Couldn’t share chat', error instanceof Error ? error.message : undefined));
      return;
    }
    if (action === 'pin') {
      togglePin(chat.id);
      return;
    }
    if (action === 'rename') {
      if (Platform.OS === 'ios') {
        Alert.prompt('Rename chat', undefined, (title) => title.trim() && renameChat(chat.id, title), 'plain-text', chat.title);
      } else {
        Alert.alert('Rename chat', 'Long-press rename is available with a native prompt on iOS.');
      }
      return;
    }
    if (action === 'move') {
      Alert.alert('Move to folder', chat.title, [
        { text: 'No folder', onPress: () => moveChat(chat.id, null) },
        ...folders.slice(0, 3).map((folder) => ({ text: folder.name, onPress: () => moveChat(chat.id, folder.id) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
      return;
    }
    if (action === 'duplicate') {
      void duplicateServerChat(chat.id).then((copy) => {
        const source = usePrototypeStore.getState().chats.find((item) => item.id === chat.id);
        upsertChat({ id: copy.id, title: copy.title, modelId: copy.modelId, pinned: copy.pinned, folderId: copy.folderId, temporary: copy.temporary, createdAt: Date.parse(copy.createdAt), updatedAt: Date.parse(copy.updatedAt), deletedAt: null, purgeAt: null, messages: source?.messages ?? [] });
      }).catch((error) => Alert.alert('Couldn’t duplicate chat', error instanceof Error ? error.message : undefined));
    }
  }, [folders, moveChat, renameChat, requiresConfirmation, togglePin, trashChat, upsertChat]);

  const showChatActions = useCallback((chat: HistoryChatSummary) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(chat.title, undefined, [
      { text: 'Rename', onPress: () => runChatAction(chat, 'rename') },
      { text: 'Share', onPress: () => runChatAction(chat, 'share') },
      { text: removeChatLabel, style: 'destructive', onPress: () => runChatAction(chat, 'delete') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [removeChatLabel, runChatAction]);

  const selectHistoryChat = useCallback((chat: HistoryChatSummary) => {
    dismissSearch();
    onSelectChat(chat);
  }, [dismissSearch, onSelectChat]);

  const renderHistoryChat = useCallback(({ item }: { item: HistoryChatSummary }) => {
    const source = usePrototypeStore.getState().chats.find((chat) => chat.id === item.id);
    const previewText = source?.messages.at(-1)?.text || DEFAULT_HISTORY_PREVIEW;
    return <HistoryChatRow
      active={activeChatId === item.id}
      chat={item}
      previewText={previewText}
      removeChatLabel={removeChatLabel}
      onChatAction={runChatAction}
      onOpenActions={showChatActions}
      onSelectChat={selectHistoryChat}
    />;
  }, [activeChatId, removeChatLabel, runChatAction, selectHistoryChat, showChatActions]);

  return (
    <View style={styles.panelRoot}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <AppHeader>
          <View style={styles.profileChip}>
            <PulpoMark size={38} />
            <Text style={styles.profileName}>Pulpo</Text>
          </View>
          <RoundButton icon="gearshape" accessibilityLabel="Settings" onPress={() => { dismissSearch(); onOpenSettings(); }} />
        </AppHeader>

        {Platform.OS === 'ios' ? <NativeDrawerSearch fieldRef={nativeSearchRef} focused={searchFocused} value={search} onChange={setSearch} onFocusChange={setSearchFocused} /> : <View style={styles.searchBox}>
          <Icon name="magnifyingglass" size={17} color="#FFFFFF" />
          <TextInput
            accessibilityLabel="Search chats"
            value={search}
            onChangeText={setSearch}
            onBlur={() => setSearchFocused(false)}
            onFocus={() => setSearchFocused(true)}
            placeholder="Search chats"
            placeholderTextColor={searchFocused ? COLORS.muted : COLORS.textSoft}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable accessibilityLabel="Clear search" accessibilityRole="button" onPress={() => setSearch('')} style={styles.smallIconButton}>
              <Icon name="xmark.circle.fill" size={15} color={COLORS.dim} />
            </Pressable>
          )}
        </View>}

        <Reanimated.View pointerEvents={searchFocused || search.length > 0 ? 'none' : 'auto'} style={searchActionsAnimatedStyle}>
          {Platform.OS === 'ios' ? <NativeDrawerAction icon="square.and.pencil" label="New chat" onPress={() => { dismissSearch(); onNewChat(); }} /> : <Pressable accessibilityRole="button" onPress={() => { dismissSearch(); onNewChat(); }} style={({ pressed }) => [styles.navRow, pressed && styles.navRowPressed]}>
            <Icon name="square.and.pencil" size={17} color={COLORS.textSoft} />
            <Text style={styles.navText}>New chat</Text>
          </Pressable>}
          {Platform.OS === 'ios' ? <NativeFoldersDisclosure folders={folderItems} onSelectChat={selectHistoryChat} onCreate={() => { dismissSearch(); Alert.prompt('New folder', 'Create a folder for related chats.', (name) => name.trim() && addFolder(name)); }} /> : <NativeObjectContextMenu
            style={styles.folderContextMenuHost}
            preview={(
              <View style={styles.folderContextPreview}>
                <Icon name="folder.fill" size={34} color={COLORS.textSoft} />
                <Text style={styles.folderContextPreviewTitle}>Folders</Text>
                <Text style={styles.folderContextPreviewMeta}>{folders.length} folders · Organize your Pulpo chats</Text>
              </View>
            )}
            items={(
              <>
                <SwiftUIButton label="New folder" systemImage="folder.badge.plus" onPress={() => Platform.OS === 'ios' && Alert.prompt('New folder', undefined, (name) => name.trim() && addFolder(name))} />
                <SwiftUIButton label="Manage folders" systemImage="folder" onPress={() => Alert.alert('Manage folders')} />
                <SwiftUIDivider />
                <SwiftUIButton label="Sort folders" systemImage="arrow.up.arrow.down" onPress={() => Alert.alert('Sort folders')} />
              </>
            )}
          >
            <Pressable
              accessibilityLabel={`Folders, ${folders.length}`}
              accessibilityRole="button"
              delayLongPress={350}
              onLongPress={() => Platform.OS !== 'ios' && Alert.alert('Folders', 'New folder · Manage folders · Sort folders')}
              onPress={() => Platform.OS === 'ios' ? Alert.prompt('New folder', 'Create a folder for related chats.', (name) => name.trim() && addFolder(name)) : Haptics.selectionAsync()}
              style={({ pressed }) => [styles.navRow, styles.folderNavRow, pressed && styles.navRowPressed]}
            >
              <Icon name="folder" size={17} color={COLORS.textSoft} />
              <Text style={styles.navText}>Folders</Text>
              <Text style={styles.navMeta}>{folders.length}</Text>
            </Pressable>
          </NativeObjectContextMenu>}
        </Reanimated.View>

        <SectionList
          contentContainerStyle={[styles.chatList, { paddingBottom: insets.bottom + 16 }]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(chat) => chat.id}
          ListEmptyComponent={loading && !search ? (
            <View accessibilityLabel="Loading chats" accessibilityRole="progressbar" style={styles.historyLoading}>
              <ActivityIndicator color={COLORS.muted} size="small" />
              <Text style={styles.noResults}>Loading chats…</Text>
            </View>
          ) : <Text style={styles.noResults}>{search ? `No chats match “${search}”` : 'No chats yet'}</Text>}
          renderItem={renderHistoryChat}
          renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
          sections={sections}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          style={styles.flex}
          onTouchStart={dismissSearch}
        />
      </SafeAreaView>
    </View>
  );
});

function ModelSheet({ visible, selected, models, onClose, onSelect }: { visible: boolean; selected: string; models: Model[]; onClose: () => void; onSelect: (model: Model) => void }) {
  if (Platform.OS === 'ios') return <NativeModelSheet visible={visible} selected={selected} models={models} onClose={onClose} onSelect={onSelect} />;
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
      <View accessibilityViewIsModal accessibilityLabel="Choose a model" onAccessibilityEscape={onClose} style={styles.sheet}>
        <SafeAreaView style={styles.sheetSafe} edges={['bottom']}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <View>
              <Text accessibilityRole="header" style={styles.sheetTitle}>Choose a model</Text>
              <Text style={styles.sheetSubtitle}>Available through Pulpo</Text>
            </View>
            <Pressable accessibilityLabel="Close model picker" accessibilityRole="button" hitSlop={6} onPress={onClose} style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}>
              <Icon name="xmark" size={14} color={COLORS.muted} weight="semibold" />
            </Pressable>
          </View>
          <Text style={styles.sheetSection}>RECOMMENDED</Text>
          {models.map((model) => (
            <Pressable
              accessibilityLabel={`${model.name}, ${model.lab}, ${model.detail}`}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === model.id }}
              delayLongPress={350}
              key={model.id}
              onLongPress={() => Alert.alert(model.name, 'Set as default · Favorite · Model information')}
              onPress={() => onSelect(model)}
              style={({ pressed }) => [styles.modelRow, pressed && styles.navRowPressed]}
            >
              <ModelMark model={model} size={42} />
              <View style={styles.flex}>
                <Text style={styles.modelRowTitle}>{model.name}</Text>
                <Text style={styles.modelRowDetail}>{model.lab} · {model.detail}</Text>
              </View>
              {selected === model.id
                ? <Icon name="checkmark.circle.fill" size={22} color={COLORS.textSoft} />
                : <Icon name="star" size={17} color={COLORS.dim} />}
            </Pressable>
          ))}
          <View style={styles.sheetFootnote}>
            <Icon name="info.circle" size={13} color={COLORS.dim} />
            <Text style={styles.sheetFootnoteText}>Routing, fallbacks and spend limits apply from your Pulpo workspace.</Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function NativeModelSheet({ visible, selected, models: availableModels, onClose, onSelect }: { visible: boolean; selected: string; models: Model[]; onClose: () => void; onSelect: (model: Model) => void }) {
  const [query, setQuery] = useState('');
  const nativeQuery = useNativeState('');
  const models = availableModels.filter((model) => `${model.name} ${model.lab} ${model.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <SwiftUIHost style={styles.nativeModalAnchorHost}><SwiftUIBottomSheet isPresented={visible} onIsPresentedChange={(presented) => { if (!presented) onClose(); }} onDismiss={() => { setQuery(''); nativeQuery.set(''); }}>
    <SwiftUIGroup modifiers={[frame({ minHeight: 560, maxWidth: Infinity })]}>
      <SwiftUIForm>
        <SwiftUISection>
          <SwiftUIHStack><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText>Choose a model</SwiftUIText><SwiftUIText modifiers={[foregroundStyle('secondary')]}>Available through Pulpo</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIButton label="Close model picker" systemImage="xmark.circle.fill" onPress={onClose} modifiers={[buttonStyle('plain'), labelStyle('iconOnly')]} /></SwiftUIHStack>
          <SwiftUIHStack spacing={8}><SwiftUIImage systemName="magnifyingglass" size={15} modifiers={[foregroundStyle('secondary')]} /><SwiftUITextField placeholder="Search models" text={nativeQuery} onTextChange={setQuery} modifiers={[textFieldStyle('plain'), frame({ maxWidth: Infinity, minHeight: 44 }), swiftUIAccessibilityLabel('Search models')]} /></SwiftUIHStack>
        </SwiftUISection>
        <SwiftUISection title="Recommended" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Routing, fallbacks, and spend limits apply from your Pulpo workspace.</SwiftUIText>}>
          {models.map((model) => <SwiftUIButton key={model.id} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={() => onSelect(model)}><SwiftUIHStack spacing={12}><SwiftUIRNHostView matchContents><View pointerEvents="none" style={styles.nativeModelAssetHost}><ModelMark model={model} size={38} /></View></SwiftUIRNHostView><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText>{model.name}</SwiftUIText><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${model.lab} · ${model.detail}`}</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName={selected === model.id ? 'checkmark.circle.fill' : 'star'} size={18} /></SwiftUIHStack></SwiftUIButton>)}
        </SwiftUISection>
      </SwiftUIForm>
    </SwiftUIGroup>
  </SwiftUIBottomSheet></SwiftUIHost>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, flexDirection: 'row', backgroundColor: COLORS.panel },
  drawerPanel: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  persistentPanel: { width: SIDEBAR_WIDTH, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: COLORS.lineSoft },
  historyLoading: { alignItems: 'center', gap: 8, paddingVertical: 20 },

  // Main chat view
  mainView: {
    ...StyleSheet.absoluteFill as object,
    borderTopLeftRadius: 38,
    borderBottomLeftRadius: 38,
    overflow: 'hidden',
    shadowColor: COLORS.text,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: -10, height: 0 },
    backgroundColor: COLORS.background,
  },
  persistentMainView: { flex: 1, minWidth: 0, overflow: 'hidden', backgroundColor: COLORS.background },
  chatRoot: { flex: 1, backgroundColor: COLORS.background },
  chatHeaderOverlay: { position: 'absolute', zIndex: 2, top: 0, left: 0, right: 0 },
  appHeader: { width: '100%', maxWidth: CHAT_CONTENT_MAX, alignSelf: 'center', height: 64, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerButtonPlaceholder: { width: 44, height: 44 },
  headerActionExpanded: { width: 88, height: 44, alignItems: 'flex-end' },
  roundButton: { alignItems: 'center', justifyContent: 'center' },
  roundButtonCustomIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  roundButtonSelected: { backgroundColor: 'rgba(175,82,222,0.18)' },
  headerActionGlyphHost: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  temporaryHeaderActionsShell: { height: 44, borderRadius: 22 },
  temporaryHeaderActions: { width: '100%', height: 44, borderRadius: 22 },
  temporaryHeaderAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  temporaryHeaderPrimaryAction: { position: 'absolute', left: 0, top: 0 },
  temporaryHeaderNewChatAction: { position: 'absolute', right: 0, top: 0, width: 44, height: 44 },
  temporaryHeaderIconLayer: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  glassFallback: { backgroundColor: COLORS.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line },
  pressed: { opacity: 0.75 },
  modelTriggerWrap: { flex: 1, alignItems: 'center' },
  modelMenuHost: { minHeight: 44, maxWidth: 230, justifyContent: 'center' },
  modelTrigger: { minHeight: 44, maxWidth: 218, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  modelTriggerText: { color: COLORS.text, fontSize: 15, fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  connectionBanner: { alignSelf: 'center', maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: COLORS.fill, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 3 },
  connectionBannerOffline: { backgroundColor: 'rgba(255,159,63,0.12)' },
  temporaryExpiredBanner: { backgroundColor: 'rgba(139,92,246,0.14)' },
  connectionBannerText: { color: COLORS.muted, fontSize: 11.5, fontWeight: '600' },
  chatContent: { width: '100%', maxWidth: CHAT_CONTENT_MAX, alignSelf: 'center' },
  conversation: { paddingBottom: 156 },
  emptyConversation: { flex: 1, justifyContent: 'center', paddingBottom: 156 },
  emptyConversationAccessible: { flexGrow: 1, justifyContent: 'flex-start', paddingBottom: 220 },
  emptyState: { width: '100%', maxWidth: 720, alignSelf: 'center', alignItems: 'center' },
  emptyIdentity: { alignItems: 'center' },
  emptyModelLineWrap: { position: 'relative', alignItems: 'center' },
  temporaryLabel: { position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  temporaryLabelText: { color: '#6d28d9', fontSize: 12, fontWeight: '600' },
  temporaryLabelTextDark: { color: '#c4b5fd' },
  pulpoMark: { shadowColor: COLORS.accent, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
  emptyModelLine: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  emptyModelLineAccessible: { flexDirection: 'column', width: '100%' },
  emptyTitle: { color: COLORS.text, fontSize: 26, fontWeight: '600', letterSpacing: -0.8, textAlign: 'center' },
  emptyProvider: { color: COLORS.muted, fontSize: 13.5, marginTop: 7 },
  userRow: { alignItems: 'flex-end', marginBottom: 30 },
  userMessageContent: { alignItems: 'flex-end', maxWidth: '88%', gap: 7 },
  userMessageContextHost: { maxWidth: '85%', alignSelf: 'flex-end' },
  userMessageContextContent: { width: '100%', alignItems: 'flex-end' },
  assistantMessageContextHost: { width: '100%' },
  userBubble: { maxWidth: '100%', backgroundColor: COLORS.secondary, borderRadius: 20, borderBottomRightRadius: 7, paddingHorizontal: 15, paddingVertical: 11 },
  userMessageMarkdown: { alignSelf: 'flex-start' },
  sentAttachments: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  assistantAttachments: { justifyContent: 'flex-start', marginTop: 8 },
  sentImageContextHost: { width: 112, height: 112 },
  sentFileContextHost: { maxWidth: 230, minHeight: 48 },
  sentAttachmentImage: { width: 112, height: 112, borderRadius: 16, backgroundColor: COLORS.fill },
  attachmentImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  sentFileAttachment: { maxWidth: 230, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 15, backgroundColor: COLORS.secondary, paddingHorizontal: 12 },
  sentFileName: { color: COLORS.text, fontSize: 13.5, flexShrink: 1 },
  messageText: { color: COLORS.text, fontSize: 15.5, lineHeight: 22.5 },
  messageContextPreview: { width: 320, maxHeight: 360, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 20 },
  messageContextPreviewUser: { backgroundColor: COLORS.secondary },
  messageContextPreviewRole: { color: COLORS.muted, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 },
  messageContextPreviewText: { color: COLORS.text, fontSize: 16, lineHeight: 24 },
  attachmentContextImagePreview: { width: 320, height: 320, borderRadius: 28, backgroundColor: COLORS.elevated },
  attachmentContextFilePreview: { width: 300, minHeight: 180, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 24, alignItems: 'center', justifyContent: 'center' },
  attachmentContextFileName: { color: COLORS.text, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 14 },
  attachmentContextFileMeta: { color: COLORS.muted, fontSize: 12, marginTop: 6 },
  assistantRow: { marginBottom: 32 },
  assistantHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  assistantName: { color: COLORS.textSoft, fontSize: 13.5, fontWeight: '600' },
  messageTime: { color: COLORS.muted, fontSize: 11.5 },
  assistantContent: { width: '100%', gap: 4 },
  assistantText: { color: COLORS.textSoft, fontSize: 15.5, lineHeight: 25.5, letterSpacing: -0.1 },
  draftText: { marginTop: 10 },
  caret: { color: COLORS.muted, fontSize: 15.5 },
  responsePending: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 28, paddingVertical: 4 },
  responsePendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.muted },
  reasoningTrigger: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, paddingVertical: 4 },
  reasoningContextHost: { width: '100%' },
  reasoningLabel: { color: COLORS.muted, fontSize: 12.5, fontWeight: '500' },
  reasoningBody: { borderLeftWidth: 2, borderLeftColor: COLORS.line, paddingLeft: 12, marginBottom: 16, marginLeft: 2, gap: 8 },
  workBlock: { width: '100%' },
  workRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 22 },
  workRowText: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18, flex: 1, textTransform: 'capitalize' },
  workRowTitle: { color: COLORS.textSoft, fontSize: 12.5, lineHeight: 18, fontWeight: '600', flex: 1 },
  workStep: { gap: 5 },
  compactionDetail: { gap: 12 },
  compactionSection: { gap: 6 },
  compactionSectionTitle: { color: COLORS.textSoft, fontSize: 12, fontWeight: '600' },
  compactionError: { color: COLORS.critical, fontSize: 12, lineHeight: 17 },
  compactionTurn: { borderRadius: 8, backgroundColor: COLORS.fill, paddingHorizontal: 9, paddingVertical: 7, gap: 3 },
  compactionRole: { color: COLORS.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  compactionContent: { color: COLORS.textSoft, fontSize: 12, lineHeight: 18 },
  workToolTrigger: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  workToolName: { color: COLORS.textSoft, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  workToolSummary: { color: COLORS.muted, fontSize: 11, lineHeight: 16, fontFamily: COLORS.mono, flex: 1 },
  workToolDuration: { color: COLORS.muted, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  workRunning: { color: COLORS.muted, fontSize: 11, marginLeft: 19 },
  workDetailScroller: { maxHeight: 250, borderRadius: 9, backgroundColor: COLORS.fill },
  workDetail: { color: COLORS.muted, fontSize: 11.5, lineHeight: 17, fontFamily: COLORS.mono, paddingHorizontal: 9, paddingVertical: 7 },
  reasoningText: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  reasoningDuration: { color: COLORS.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  reasoningContextPreview: { width: 320, minHeight: 180, maxHeight: 380, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 20 },
  reasoningContextPreviewTitle: { color: COLORS.muted, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.8, marginBottom: 12 },
  reasoningContextPreviewText: { color: COLORS.textSoft, fontSize: 14.5, lineHeight: 21 },
  messageMeta: { color: COLORS.muted, fontSize: 11, marginTop: 12, fontFamily: COLORS.mono, letterSpacing: -0.2 },
  responseError: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,92,92,0.35)', backgroundColor: 'rgba(255,92,92,0.10)', borderRadius: 12, padding: 11, marginTop: 6 },
  responseErrorText: { color: COLORS.critical, flex: 1, fontSize: 12.5, lineHeight: 18 },
  tryAgainText: { color: COLORS.criticalAction, fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  otherOutput: { borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line, borderRadius: 12, padding: 10, gap: 7, marginTop: 6 },
  continueButton: { alignSelf: 'stretch', minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.fillStrong, marginTop: 8 },
  continueButtonText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  branchControls: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 5 },
  branchLabel: { color: COLORS.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  iconAction: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  disabledIconAction: { opacity: 0.35 },

  suggestionReveal: { width: '100%', overflow: 'hidden' },
  suggestionGrid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  suggestionGridAccessible: { flexDirection: 'column', flexWrap: 'nowrap' },
  suggestionCard: { width: '48.7%', minHeight: 68, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line, backgroundColor: COLORS.card, paddingHorizontal: 13, paddingVertical: 11, justifyContent: 'center' },
  temporarySuggestionCardLight: { backgroundColor: 'rgba(237,233,254,0.82)', borderColor: 'rgba(139,92,246,0.48)' },
  temporarySuggestionCardDark: { backgroundColor: 'rgba(46,16,101,0.58)', borderColor: 'rgba(124,58,237,0.52)' },
  suggestionCardAccessible: { width: '100%' },
  suggestionLabel: { color: COLORS.textSoft, fontSize: 13, lineHeight: 18 },

  composerSticky: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  composerWrap: { paddingTop: 6 },
  composer: { minHeight: 108, borderRadius: 28, paddingTop: 12, paddingHorizontal: 10, paddingBottom: 4 },
  messageEditBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 6, paddingBottom: 8 },
  messageEditBannerText: { flex: 1, color: COLORS.text, fontSize: 12, fontWeight: '600' },
  messageEditCancel: { color: COLORS.muted, fontSize: 12, fontWeight: '600', paddingHorizontal: 4, paddingVertical: 2 },
  attachmentRestrictionText: { color: COLORS.warning, fontSize: 11, lineHeight: 15, paddingHorizontal: 6, paddingBottom: 6 },
  attachmentStrip: { maxHeight: 112, marginBottom: 8 },
  attachmentStripContent: { gap: 8, paddingHorizontal: 2 },
  attachmentFrame: { paddingTop: 17, paddingRight: 17 },
  attachmentUploadStatus: { color: COLORS.muted, fontSize: 10, marginTop: 3, maxWidth: 148 },
  attachmentUploadFailed: { color: COLORS.critical, fontWeight: '600' },
  imageAttachment: { width: 72, height: 72, borderRadius: 14, overflow: 'visible', backgroundColor: COLORS.fill },
  attachmentImage: { width: 72, height: 72, borderRadius: 14 },
  fileAttachment: { width: 174, height: 72, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11, backgroundColor: COLORS.fill },
  fileAttachmentIcon: { width: 32, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.fillStrong },
  fileAttachmentCopy: { flex: 1 },
  fileAttachmentName: { color: COLORS.text, fontSize: 12.5, fontWeight: '600' },
  fileAttachmentMeta: { color: COLORS.muted, fontSize: 10.5, marginTop: 3 },
  removeAttachmentHitTarget: { position: 'absolute', top: -17, right: -17, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeAttachmentButton: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3a3a3c', borderWidth: 2, borderColor: COLORS.elevated },
  input: { minHeight: 30, maxHeight: 120, color: COLORS.text, fontSize: 16, lineHeight: 22, paddingHorizontal: 5, paddingTop: 0 },
  composerBar: { flexDirection: 'row', alignItems: 'center', marginTop: 'auto', gap: 1 },
  composerCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.fillStrong, alignItems: 'center', justifyContent: 'center' },
  nativeComposerCircleHost: { width: 44, height: 44 },
  agentCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  agentCircleActive: { backgroundColor: '#AF52DE' },
  nativeAgentHost: { width: 44, height: 44 },
  nativeAgentIcon: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  effortPill: { minHeight: 44, borderRadius: 22, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  effortMenuHost: { minHeight: 44, justifyContent: 'center' },
  effortText: { color: COLORS.muted, fontSize: 12.5, fontWeight: '500' },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.38 },
  sendDisabled: { backgroundColor: COLORS.secondary },

  optionModal: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000044' },
  optionSheet: { width: '100%', maxWidth: 620, alignSelf: 'center', backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28 },
  optionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  optionSubtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 14 },
  optionRow: { minHeight: 52, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionRowText: { color: COLORS.text, fontSize: 16, fontWeight: '500' },

  // History panel
  panelRoot: { flex: 1, backgroundColor: COLORS.panel },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  profileName: { color: COLORS.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  searchBox: { height: DRAWER_ACTION_HEIGHT, marginHorizontal: 10, marginTop: 6, borderRadius: 13, backgroundColor: COLORS.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  nativeDrawerSearchHost: { height: DRAWER_ACTION_HEIGHT, marginHorizontal: 22, marginTop: 6, borderRadius: 13, backgroundColor: COLORS.panel },
  nativeDrawerActionHost: { height: DRAWER_ACTION_HEIGHT, marginHorizontal: 22 },
  nativeFoldersDisclosureHost: { alignSelf: 'stretch', minHeight: DRAWER_ACTION_HEIGHT, marginHorizontal: 22 },
  nativeFoldersHeaderHost: { alignSelf: 'stretch', height: DRAWER_ACTION_HEIGHT },
  nativeFoldersContent: { alignSelf: 'stretch', overflow: 'hidden' },
  nativeFolderGroup: { alignSelf: 'stretch', overflow: 'hidden' },
  nativeFolderRowHost: { alignSelf: 'stretch', height: 40 },
  nativeFolderChatRowHost: { alignSelf: 'stretch', height: 38 },
  nativeFolderEmptyRowHost: { alignSelf: 'stretch', height: 34 },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 15, fontWeight: '500', padding: 0 },
  navRow: { minHeight: DRAWER_ACTION_HEIGHT, marginHorizontal: 10, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  folderContextMenuHost: { height: DRAWER_ACTION_HEIGHT, marginHorizontal: 10 },
  folderNavRow: { marginHorizontal: 0 },
  folderContextPreview: { width: 280, minHeight: 170, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 24, alignItems: 'center', justifyContent: 'center' },
  folderContextPreviewTitle: { color: COLORS.text, fontSize: 20, fontWeight: '600', marginTop: 12 },
  folderContextPreviewMeta: { color: COLORS.muted, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
  navRowPressed: { backgroundColor: COLORS.fill },
  navText: { color: COLORS.textSoft, fontSize: 15, fontWeight: '500' },
  navMeta: { color: COLORS.muted, fontSize: 12.5, marginLeft: 'auto' },
  chatList: { paddingHorizontal: 10, paddingBottom: 16 },
  sectionLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '600', marginTop: 16, marginBottom: 5, marginHorizontal: 12 },
  chatContextMenuHost: { width: '100%', height: 44 },
  chatRow: { minHeight: 44, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatRowActive: { backgroundColor: COLORS.secondary },
  chatTitle: { color: COLORS.textSoft, fontSize: 15 },
  chatTime: { color: COLORS.muted, fontSize: 12 },
  noResults: { color: COLORS.muted, fontSize: 13.5, textAlign: 'center', marginTop: 30 },
  // Model sheet
  nativeModalAnchorHost: { position: 'absolute', width: 1, height: 1, right: 0, top: 0 },
  nativeModelAssetHost: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, backgroundColor: COLORS.background },
  sheetSafe: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 18 },
  sheetGrabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: COLORS.fillStrong, alignSelf: 'center', marginTop: 8, marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sheetTitle: { color: COLORS.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  sheetSubtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4 },
  sheetClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center' },
  sheetSection: { color: COLORS.muted, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.7, marginTop: 24, marginBottom: 6, marginLeft: 3 },
  modelRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.lineSoft, borderRadius: 8, paddingHorizontal: 3 },
  modelRowTitle: { color: COLORS.text, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2 },
  modelRowDetail: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  sheetFootnote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, paddingHorizontal: 3 },
  sheetFootnoteText: { color: COLORS.muted, fontSize: 11.5, flex: 1, lineHeight: 16 },

  smallIconButton: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
});
