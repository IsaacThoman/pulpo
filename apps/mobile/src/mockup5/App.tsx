import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Appearance,
  type ColorValue,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
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
  Toggle as SwiftUIToggle,
  VStack as SwiftUIVStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint as swiftUIAccessibilityHint,
  accessibilityLabel as swiftUIAccessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as swiftUIDisabled,
  foregroundStyle,
  font,
  frame,
  labelStyle,
  labelsHidden,
  menuActionDismissBehavior,
  padding,
  resizable,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ExpoHaptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { usePathname } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationLightTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider, KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, {
  FadeInUp,
  FadeOutUp,
  interpolate,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthExperience } from './src/screens/AuthExperience';
import {
  AccountScreen,
  ChangePasswordScreen,
  EditProfileScreen,
  InstanceDetailsScreen,
  MemberSettingsScreen,
  SearchScreen,
  SettingsDetailScreen,
  SharedChatScreen,
  TrashScreen,
} from './src/screens/MemberScreens';
import type { RootStackParamList } from './src/navigation';
import { usePrototypeStore } from './src/store/prototypeStore';
import type { ActivityStep, PrototypeChat, PrototypeMessage, PrototypeModel } from './src/domain';
import { useSessionStore } from '../store/session';
import { ProductionBridge } from './src/production/ProductionBridge';
import { cacheNamespace } from '../data/database';
import { queryKeys } from '../data/queries';
import { activateBranch as activateServerBranch, cancelResponse, createChat as createServerChat, deleteMessageCascade as deleteServerMessage, downloadAttachment, duplicateChat as duplicateServerChat, editMessage as editServerMessage, regenerateResponse as regenerateServerResponse, sendMessage as sendServerMessage, shareAttachment as shareServerAttachment, shareChat as shareServerChat, uploadAttachment } from '../features/chat/api';
import { useRealtimeStore } from '../providers/RealtimeProvider';
import { aiIconSource } from './src/production/AiIconAssets';

function systemColor(ios: string, android: string, fallback: string): ColorValue {
  if (Platform.OS === 'ios') return PlatformColor(ios);
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
  muted: systemColor('secondaryLabel', '?attr/textColorSecondary', '#3c3c4399'),
  dim: systemColor('tertiaryLabel', '?attr/textColorSecondary', '#3c3c434d'),
  fill: systemColor('tertiarySystemFill', '?attr/colorControlHighlight', '#7676801f'),
  fillStrong: systemColor('secondarySystemFill', '?attr/colorControlHighlight', '#78788029'),
  accent: systemColor('systemBlue', '?attr/colorAccent', '#007aff'),
  positive: systemColor('systemGreen', '?attr/colorAccent', '#34c759'),
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
  }), [haptics, setHaptics, setTheme, showReasoning, smoothStreaming, textSize, theme]);

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

type Model = { name: string; lab: string; icon: ImageSourcePropType; labIcon?: ImageSourcePropType; menuIcon?: ImageSourcePropType; tintColor?: ColorValue; detail: string };
type ModelSection = 'Favorites' | Model['lab'];
type Attachment = {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  size?: number;
  kind: 'image' | 'file';
};
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
  thinkSeconds?: number;
  reasoning?: string;
  meta?: string;
  activity?: ActivityStep[];
};
type Chat = { id: string; title: string; time: string; section: string; messages: Message[] };
type StreamingSession = {
  id: string;
  chatKey: string;
  response: string;
  thinkSeconds: number;
};
type SendOptions = { reasoningEffort: ReasoningEffort; agentEnabled: boolean; temporary: boolean };

const MODELS: Model[] = [
  { name: 'Claude Sonnet 4', lab: 'Anthropic', icon: require('./assets/model-claude.png'), detail: 'Balanced reasoning and speed' },
  { name: 'GPT-5', lab: 'OpenAI', icon: require('./assets/model-openai.png'), menuIcon: require('./assets/model-openai-menu.png'), tintColor: COLORS.textSoft, detail: 'Strong general intelligence' },
  { name: 'Gemini 2.5 Pro', lab: 'Google', icon: require('./assets/model-gemini.png'), detail: '1M context · Vision' },
  { name: 'DeepSeek R1', lab: 'DeepSeek', icon: require('./assets/model-deepseek.png'), detail: 'Deep reasoning traces' },
];

function prototypeModelToLegacy(model: PrototypeModel, isDark: boolean): Model {
  const template = MODELS.find((candidate) => candidate.lab === model.lab)
    ?? MODELS[{ claude: 0, openai: 1, gemini: 2, deepseek: 3 }[model.asset]]
    ?? MODELS[1];
  const icon = aiIconSource(model.modelLogo ?? model.labLogo, isDark);
  return { ...template, name: model.name, lab: model.lab, detail: model.description, icon, menuIcon: icon, labIcon: aiIconSource(model.labLogo, isDark), tintColor: undefined };
}

const MODEL_SECTIONS: ModelSection[] = ['Favorites', ...new Set(MODELS.map((model) => model.lab))];

const REASONING_SAMPLE =
  'The user wants a practical answer, not an architecture lecture. Lead with the state boundary: durable messages in the store, transient tokens in the view. Mention the commit-once pattern and why it keeps rendering cheap.';

const RESPONSES = [
  'Keep the durable conversation in your store, but hold the active token stream close to the view. Commit the finished response once, rather than writing every token through global state.\n\nThis gives you smooth rendering, clean persistence, and a much smaller update surface.',
  'A three-step flow works well here: a single welcome screen with the value proposition, one permissions primer that explains why before iOS asks, and a deferred account step that lets people try the product first.\n\nThe key is that every step earns its place. If a screen does not reduce a real drop-off, cut it.',
  'KV caching stores the key and value tensors computed for previous tokens so the model does not recompute them for every new token. That turns generation from quadratic reprocessing into a linear append.\n\nThe tradeoff is memory: the cache grows with context length, which is why long-context serving is bandwidth-bound.',
];

const CHATS: Chat[] = [
  {
    id: 'c1', title: 'Streaming state architecture', time: '9:42 AM', section: 'Today',
    messages: [
      { id: 'c1u1', role: 'user', text: 'How should I structure streaming state in a React chat app?' },
      {
        id: 'c1a1', role: 'assistant', text: RESPONSES[0], thinkSeconds: 8, reasoning: REASONING_SAMPLE,
        meta: '1,204→356 tok · 42 tok/s · 8.4s',
      },
    ],
  },
  {
    id: 'c2', title: 'Mobile onboarding flow', time: '8:15 AM', section: 'Today',
    messages: [
      { id: 'c2u1', role: 'user', text: 'Help me design an onboarding flow for the Pulpo mobile app.' },
      {
        id: 'c2a1', role: 'assistant', text: RESPONSES[1], thinkSeconds: 5, reasoning: REASONING_SAMPLE,
        meta: '860→412 tok · 51 tok/s · 8.1s',
      },
    ],
  },
  { id: 'c3', title: 'SSE vs WebSockets', time: 'Yesterday', section: 'Yesterday', messages: [
    { id: 'c3u1', role: 'user', text: 'SSE or WebSockets for token streaming?' },
    { id: 'c3a1', role: 'assistant', text: 'For token streaming, SSE is usually enough: one-directional, automatic reconnects, and it rides plain HTTP through proxies. WebSockets earn their complexity when you need bidirectional traffic, like live cancellation channels or collaborative sessions.', thinkSeconds: 3, reasoning: REASONING_SAMPLE, meta: '640→198 tok · 47 tok/s · 4.2s' },
  ] },
  { id: 'c4', title: 'Message branching design', time: 'Tue', section: 'Previous 7 Days', messages: [] },
  { id: 'c5', title: 'Cmd+K palette patterns', time: 'Mon', section: 'Previous 7 Days', messages: [] },
  { id: 'c6', title: 'Scroll anchoring fix', time: 'Jul 24', section: 'Previous 30 Days', messages: [] },
  { id: 'c7', title: 'Sidebar search naming', time: 'Jul 19', section: 'Previous 30 Days', messages: [] },
  { id: 'c8', title: 'KV caching explainer', time: 'Jul 12', section: 'Previous 30 Days', messages: [
    { id: 'c8u1', role: 'user', text: 'Explain KV caching in one paragraph.' },
    { id: 'c8a1', role: 'assistant', text: RESPONSES[2], thinkSeconds: 4, reasoning: REASONING_SAMPLE, meta: '512→171 tok · 55 tok/s · 3.1s' },
  ] },
];

function prototypeSection(updatedAt: number) {
  const days = Math.floor((Date.now() - updatedAt) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  return 'Previous 30 Days';
}

function prototypeMessageToLegacy(message: PrototypeMessage): Message {
  const reasoning = message.activity?.find((step) => step.kind === 'reasoning')?.detail;
  return {
    id: message.id,
    role: message.role,
    text: message.branches?.[message.activeBranch ?? 0]?.text ?? message.text,
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
    meta: message.status === 'failed' ? message.error : message.meta,
    activity: message.activity,
  };
}

function prototypeChatToLegacy(chat: PrototypeChat): Chat {
  return {
    id: chat.id,
    title: chat.title,
    time: chat.updatedAt > Date.now() - 86_400_000
      ? new Date(chat.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : new Date(chat.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    section: chat.pinned ? 'Pinned' : prototypeSection(chat.updatedAt),
    messages: chat.messages.map(prototypeMessageToLegacy),
  };
}

const SUGGESTIONS = [
  'What can you help me build today?',
  'Explain how KV caching speeds up decoding',
  'Draft a terse commit message for a sidebar refactor',
  'Compare mixture-of-experts vs dense models',
];

const REASONING_EFFORTS = ['Low', 'Medium', 'High'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

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
  const prominentForeground = colorScheme === 'dark' ? '#1c1c1e' : '#ffffff';
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

function NativeAttachmentMenu({ onPickPhotos, onPickFiles }: { onPickPhotos: () => void; onPickFiles: () => void }) {
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
        <SwiftUIButton label="Photo Library" systemImage="photo.on.rectangle" onPress={onPickPhotos} />
        <SwiftUIButton label="Choose Files" systemImage="doc" onPress={onPickFiles} />
      </SwiftUIMenu>
    </SwiftUIHost>
  );
}

function AttachmentStrip({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (id: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.attachmentStripContent}
      showsHorizontalScrollIndicator={false}
      style={styles.attachmentStrip}
    >
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.attachmentFrame}>
          <View style={attachment.kind === 'image' ? styles.imageAttachment : styles.fileAttachment}>
            {attachment.kind === 'image' ? (
              <Image accessibilityLabel={attachment.name} source={{ uri: attachment.uri }} style={styles.attachmentImage} />
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
              onPress={() => onRemove(attachment.id)}
              style={styles.removeAttachmentHitTarget}
            >
              <View style={styles.removeAttachmentButton}>
                <Icon name="xmark" size={9} color="#ffffff" weight="bold" />
              </View>
            </Pressable>
          </View>
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

function PulpoMark({ size = 40 }: { size?: number }) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      accessibilityLabel="Pulpo"
      source={require('./assets/pulpo-smiley.png')}
      style={[styles.pulpoMark, { width: size, height: size, borderRadius: size / 2 }]}
    />
  );
}

function Glass({ children, style, interactive = false }: { children: ReactNode; style?: ComponentProps<typeof View>['style']; interactive?: boolean }) {
  const colorScheme = useColorScheme();
  const { reduceTransparency } = useAccessibilityPreferences();
  const available = Platform.OS === 'ios' && isGlassEffectAPIAvailable() && !reduceTransparency;
  if (!available) return <View style={[styles.glassFallback, style]}>{children}</View>;
  return (
    <GlassView colorScheme={colorScheme === 'light' || colorScheme === 'dark' ? colorScheme : undefined} glassEffectStyle="regular" isInteractive={interactive} style={style}>
      {children}
    </GlassView>
  );
}

function RoundButton({ icon, onPress, accessibilityLabel, size = 44 }: { icon: SymbolName; onPress: () => void; accessibilityLabel: string; size?: number }) {
  if (Platform.OS === 'ios') {
    return (
      <SwiftUIHost matchContents style={{ width: size, height: size }}>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            controlSize('regular'),
            swiftUIAccessibilityLabel(accessibilityLabel),
          ]}
        >
          <SwiftUIImage systemName={icon as NativeButtonSystemImage} size={18} modifiers={[frame({ width: 28, height: 28 })]} />
        </SwiftUIButton>
      </SwiftUIHost>
    );
  }
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" onPress={onPress} hitSlop={8}>
      {({ pressed }) => (
        <Glass interactive style={[styles.roundButton, { width: size, height: size, borderRadius: size / 2 }, pressed && styles.pressed]}>
          <Icon name={icon} size={size * 0.44} />
        </Glass>
      )}
    </Pressable>
  );
}

function AppHeader({ children }: { children: ReactNode }) {
  return <View style={styles.appHeader}>{children}</View>;
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

function NativeChatActionsMenu({
  temporary,
  onTemporaryChange,
  onShare,
  onNewChat,
}: {
  temporary: boolean;
  onTemporaryChange: (value: boolean) => void;
  onShare: () => void;
  onNewChat: () => void;
}) {
  return (
    <SwiftUIHost matchContents style={styles.nativeHeaderActionHost}>
      <SwiftUIMenu
        label={<SwiftUIImage systemName="ellipsis" size={18} modifiers={[frame({ width: 28, height: 28 })]} />}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('regular'),
          swiftUIAccessibilityLabel('Chat actions'),
        ]}
      >
        <SwiftUIToggle
          isOn={temporary}
          label="Temporary chat"
          systemImage="eye.slash"
          onIsOnChange={(value) => {
            onTemporaryChange(value);
            Haptics.selectionAsync();
          }}
        />
        <SwiftUIButton label="Share chat" systemImage="square.and.arrow.up" onPress={onShare} />
        <SwiftUIDivider />
        <SwiftUIButton label="New chat" systemImage="square.and.pencil" onPress={onNewChat} />
      </SwiftUIMenu>
    </SwiftUIHost>
  );
}

function IconAction({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}
    >
      <Icon name={icon} size={16} color={COLORS.muted} />
    </Pressable>
  );
}

function ModelMark({ model, size = 28 }: { model: Model; size?: number }) {
  return (
    <Image
      resizeMode="contain"
      source={model.icon}
      style={{ width: size, height: size, tintColor: model.tintColor }}
    />
  );
}

/** Pulsing dot used while the assistant is thinking. */
function ThinkingLabel({ label }: { label: string }) {
  const { reduceMotion } = useAccessibilityPreferences();
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="text" style={styles.thinkingRow}>
      <Animated.View style={{ opacity: pulse }}>
        <Icon name="brain.head.profile" size={15} color={COLORS.muted} />
      </Animated.View>
      <Text style={styles.thinkingText}>{label}</Text>
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

export default function App({ initialShareToken }: { initialShareToken?: string }) {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <AppPreferencesProvider>
            <AccessibilityPreferencesProvider>
              <PrototypeRoot initialShareToken={initialShareToken} />
            </AccessibilityPreferencesProvider>
          </AppPreferencesProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function PrototypeRoot({ initialShareToken }: { initialShareToken?: string }) {
  const incomingUrl = Linking.useURL();
  const pathname = usePathname();
  const shareToken = initialShareToken ?? pathname.match(/^\/share\/([^/]+)/)?.[1];
  const productionStatus = useSessionStore((state) => state.status);
  const productionUser = useSessionStore((state) => state.user);
  const productionInstanceUrl = useSessionStore((state) => state.instanceUrl);
  const productionConfig = useSessionStore((state) => state.config);
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
  if (status !== 'signed-in' && !incomingUrl?.includes('/share/') && !shareToken) return <AuthExperience />;
  return (
    <NavigationContainer
      theme={navigationTheme}
      linking={{
        prefixes: ['pulpo://', 'https://pulpo.baby'],
        config: { screens: { SharedChat: 'share/:token' } },
      }}
    >
      <RootStack.Navigator
        initialRouteName={shareToken ? 'SharedChat' : 'Chat'}
        screenOptions={{ animation: 'default', contentStyle: { backgroundColor: isDark ? '#000000' : '#F5F5F7' }, headerShown: false, headerShadowVisible: false }}
      >
        <RootStack.Screen name="Chat" component={AppContent} />
        <RootStack.Screen name="Search" component={SearchScreen} />
        <RootStack.Screen name="Settings" component={MemberSettingsScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Settings' }} />
        <RootStack.Screen name="Account" component={AccountScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Account', headerBackTitle: 'Settings' }} />
        <RootStack.Screen name="EditProfile" component={EditProfileScreen} options={{ headerShown: Platform.OS === 'ios', presentation: 'formSheet', title: 'Edit Profile' }} />
        <RootStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Change Password', headerBackTitle: 'Account' }} />
        <RootStack.Screen name="InstanceDetails" component={InstanceDetailsScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Pulpo Instance', headerBackTitle: 'Account' }} />
        <RootStack.Screen name="SettingsDetail" component={SettingsDetailScreen} options={{ headerShown: Platform.OS === 'ios', headerBackTitle: 'Settings' }} />
        <RootStack.Screen name="Trash" component={TrashScreen} options={{ headerShown: Platform.OS === 'ios', title: 'Trash', headerBackTitle: 'Settings' }} />
        <RootStack.Screen name="SharedChat" component={SharedChatScreen} initialParams={shareToken ? { token: decodeURIComponent(shareToken) } : undefined} />
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
  const peek = 64;
  const openOffset = width - peek;

  const slideX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const storedChats = usePrototypeStore((state) => state.chats);
  const defaultModelId = usePrototypeStore((state) => state.defaultModelId);
  const upsertChat = usePrototypeStore((state) => state.upsertChat);
  const appendStoredMessage = usePrototypeStore((state) => state.appendMessage);
  const prototypeModels = usePrototypeStore((state) => state.models);
  const demo = usePrototypeStore((state) => state.demo);
  const defaultModelName = prototypeModels.find((model) => model.id === defaultModelId)?.name;
  const availableModels = useMemo(() => prototypeModels.map((model) => prototypeModelToLegacy(model, isDark)), [isDark, prototypeModels]);
  const [selectedModel, setSelectedModel] = useState(() => availableModels.find((model) => model.name === defaultModelName) ?? availableModels[0] ?? MODELS[0]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [assistantStatus, setAssistantStatus] = useState<'idle' | 'thinking' | 'streaming'>('idle');
  const [streamingSession, setStreamingSession] = useState<StreamingSession | null>(null);
  const thinkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseIndex = useRef(0);
  const activeResponseId = useRef<string | null>(null);
  const liveSnapshots = useRealtimeStore((state) => state.snapshots);

  useEffect(() => {
    const defaultModel = prototypeModels.find((model) => model.id === defaultModelId);
    if (!defaultModel) return;
    setSelectedModel((current) => availableModels.find((model) => model.name === current.name) ?? prototypeModelToLegacy(defaultModel, isDark));
  }, [availableModels, defaultModelId, isDark, prototypeModels]);

  useEffect(() => {
    const responseId = activeResponseId.current;
    if (!responseId) return;
    const status = liveSnapshots[responseId]?.status;
    if (!status || status === 'queued' || status === 'in_progress') return;
    activeResponseId.current = null;
    setAssistantStatus('idle');
    AccessibilityInfo.announceForAccessibility(status === 'completed' ? 'Response complete' : 'Response stopped');
    if (status === 'completed') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [liveSnapshots]);

  useEffect(() => {
    return () => {
      if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    };
  }, []);

  useEffect(() => {
    const requestedChatId = route.params?.chatId;
    if (!requestedChatId || !storedChats.some((chat) => chat.id === requestedChatId && chat.deletedAt === null)) return;
    setActiveChatId(requestedChatId);
    setAssistantStatus('idle');
    setStreamingSession(null);
    navigation.setParams({ chatId: undefined });
  }, [navigation, route.params?.chatId, storedChats]);

  const animatePanel = useCallback((open: boolean, velocity = 0) => {
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
  }, [openOffset, reduceMotion, slideX]);

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
    .enabled(!panelOpen)
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
      settlePanelGesture,
      slideX,
    ]);

  const closePanelGesture = useMemo(() => Gesture.Pan()
    .enabled(panelOpen)
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
      settlePanelGesture,
      slideX,
    ]);

  const panelGesture = useMemo(
    () => Gesture.Simultaneous(openPanelGesture, closePanelGesture),
    [closePanelGesture, openPanelGesture],
  );

  const mainAnimatedStyle = useAnimatedStyle(() => {
    const progress = openOffset > 0 ? slideX.value / openOffset : 0;
    return {
      transform: [
        { translateX: slideX.value },
        { scale: reduceMotion ? 1 : interpolate(progress, [0, 1], [1, 0.965]) },
      ],
    };
  }, [openOffset, reduceMotion]);
  const panelAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reduceMotion ? 0 : interpolate(slideX.value, [0, openOffset], [-36, 0]) }],
  }), [openOffset, reduceMotion]);
  const legacyChats = useMemo(() => storedChats.filter((chat) => chat.deletedAt === null).map(prototypeChatToLegacy), [storedChats]);
  const activePrototypeChat = useMemo(() => storedChats.find((chat) => chat.id === activeChatId && chat.deletedAt === null) ?? null, [activeChatId, storedChats]);
  const activeChat = useMemo(() => activePrototypeChat ? prototypeChatToLegacy(activePrototypeChat) : null, [activePrototypeChat]);
  const messages = activeChat?.messages ?? [];

  const selectChat = (chat: Chat) => {
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = null;
    setActiveChatId(chat.id);
    setAssistantStatus('idle');
    setStreamingSession(null);
    animatePanel(false);
  };

  const newChat = () => {
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = null;
    setAssistantStatus('idle');
    setStreamingSession(null);
    setActiveChatId(null);
    setInput('');
  };

  const sendMessage = (value = input, attachments: Attachment[] = [], options?: SendOptions) => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || assistantStatus !== 'idle') return false;
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    setInput('');
    const timestamp = Date.now();
    const key = activeChat?.id ?? Crypto.randomUUID();
    const selectedPrototypeModel = prototypeModels.find((model) => model.name === selectedModel.name);
    if (!activeChat) {
      upsertChat({
        id: key,
        title: trimmed ? trimmed.split(/\s+/).slice(0, 7).join(' ') : attachments[0]?.name ?? 'Attachment chat',
        modelId: selectedPrototypeModel?.id ?? defaultModelId,
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
        folderId: null,
        temporary: false,
        deletedAt: null,
        purgeAt: null,
        messages: [],
      });
      setActiveChatId(key);
    }
    appendStoredMessage(key, {
      id: `u${timestamp}`,
      role: 'user',
      text: trimmed,
      createdAt: timestamp,
      status: demo.network === 'offline' ? 'queued' : 'complete',
      attachments: attachments.map((attachment) => ({
        id: attachment.id, name: attachment.name, uri: attachment.uri, mimeType: attachment.mimeType,
        sizeBytes: attachment.size ?? 0, kind: attachment.kind, status: 'ready',
      })),
    });
    setAssistantStatus('thinking');
    setStreamingSession(null);
    let serverChatCreated = Boolean(activeChat);
    void (async () => {
      let serverChatId = activeChat?.id;
      if (!serverChatId) {
        const created = await createServerChat({
          clientId: key,
          modelId: selectedPrototypeModel?.id ?? defaultModelId,
          temporary: options?.temporary ?? false,
          title: trimmed ? trimmed.split(/\s+/).slice(0, 7).join(' ') : attachments[0]?.name ?? 'Attachment chat',
        });
        serverChatId = created.id;
        serverChatCreated = true;
        setActiveChatId(created.id);
      }
      const uploaded = await Promise.all(attachments.map((attachment) => uploadAttachment({
        localId: attachment.id,
        name: attachment.name,
        uri: attachment.uri,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size ?? 0,
        state: 'local',
      }, serverChatId)));
      const response = await sendServerMessage({
        chatId: serverChatId,
        content: trimmed,
        modelId: selectedPrototypeModel?.id ?? defaultModelId,
        parentResponseId: activePrototypeChat?.messages.filter((message) => message.role === 'assistant').at(-1)?.id ?? null,
        presetSelections: Object.fromEntries((selectedPrototypeModel?.presets ?? []).flatMap((preset) => {
          const choice = preset.choices.find((item) => item.label.toLowerCase() === options?.reasoningEffort.toLowerCase());
          return choice ? [[preset.id, choice.id]] : [];
        })),
        attachmentIds: uploaded.map((attachment) => attachment.id),
        agentMode: options?.agentEnabled ?? false,
      });
      activeResponseId.current = response.responseId;
      setAssistantStatus('streaming');
      if (productionUserId) {
        const namespace = cacheNamespace(productionInstanceUrl, productionUserId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, serverChatId) });
      }
    })().catch((error) => {
      setAssistantStatus('idle');
      if (!activeChat && !serverChatCreated) {
        usePrototypeStore.getState().discardChat(key);
        setActiveChatId((current) => current === key ? null : current);
        setInput((current) => current || value);
      }
      const message = error instanceof Error ? error.message : 'The message could not be sent.';
      Alert.alert('Couldn’t send message', message);
    });
    return true;
  };

  const completeStreamingResponse = useCallback((session: StreamingSession) => {
    const words = session.response.split(' ');
    const tokensIn = 480 + Math.floor(Math.random() * 900);
    const tokensOut = words.length + 90;
    const seconds = (3 + Math.random() * 6).toFixed(1);
    const timestamp = Date.now();
    const selectedPrototypeModel = usePrototypeStore.getState().models.find((model) => model.name === selectedModel.name);
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
      modelId: selectedPrototypeModel?.id ?? usePrototypeStore.getState().defaultModelId,
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
  }, [appendStoredMessage, selectedModel.name]);

  const stopGeneration = useCallback(() => {
    if (thinkingTimer.current) clearTimeout(thinkingTimer.current);
    thinkingTimer.current = null;
    setStreamingSession(null);
    setAssistantStatus('idle');
    if (activeResponseId.current) {
      void cancelResponse(activeResponseId.current).finally(() => { activeResponseId.current = null; });
    }
    AccessibilityInfo.announceForAccessibility('Response stopped');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <View style={styles.root}>
      <ProductionBridge activeChatId={activeChatId} />
      <StatusBar style="auto" />

      {/* History page, revealed underneath as the chat view slides right */}
      <Reanimated.View
        accessibilityElementsHidden={!panelOpen}
        importantForAccessibility={!panelOpen ? 'no-hide-descendants' : 'auto'}
        style={[StyleSheet.absoluteFill, panelAnimatedStyle]}
      >
        <HistoryPanel
          chats={legacyChats}
          activeChatId={activeChatId}
          drawerOpen={panelOpen}
          onSelectChat={selectChat}
          onNewChat={() => { newChat(); animatePanel(false); }}
          onOpenSettings={() => {
            Keyboard.dismiss();
            navigation.navigate('Settings');
          }}
        />
      </Reanimated.View>

      {/* Main chat view sliding over to the right */}
      <GestureDetector gesture={panelGesture}>
        <Reanimated.View
          accessibilityElementsHidden={panelOpen}
          importantForAccessibility={panelOpen ? 'no-hide-descendants' : 'auto'}
          style={[styles.mainView, mainAnimatedStyle]}
        >
          <ChatView
            messages={messages}
            chatId={activeChat?.id ?? null}
            chatTitle={activeChat?.title ?? null}
            model={selectedModel}
            models={availableModels}
            input={input}
            onChangeInput={setInput}
            onSend={sendMessage}
            onStop={stopGeneration}
            assistantStatus={assistantStatus}
            streamingSession={streamingSession}
            onStreamingComplete={completeStreamingResponse}
            onOpenPanel={() => animatePanel(true)}
            onOpenModelPicker={() => { Haptics.selectionAsync(); setModelSheet(true); }}
            onSelectModel={(model) => {
              setSelectedModel(model);
              Haptics.selectionAsync();
            }}
            onNewChat={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); newChat(); }}
          />
          {/* Tap catcher while the panel is open */}
          {panelOpen && (
            <Pressable accessibilityLabel="Close chats" accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => animatePanel(false)} />
          )}
        </Reanimated.View>
      </GestureDetector>

      <ModelSheet
        models={availableModels}
        visible={modelSheet}
        selected={selectedModel.name}
        onClose={() => setModelSheet(false)}
        onSelect={(model) => {
          setSelectedModel(model);
          setModelSheet(false);
          Haptics.selectionAsync();
        }}
      />
    </View>
  );
}

function MessageContextMenu({ message, children }: { message: Message; children: ReactNode }) {
  const containingChat = usePrototypeStore((state) => state.chats.find((chat) => chat.messages.some((candidate) => candidate.id === message.id)));
  const updateStoredMessage = usePrototypeStore((state) => state.updateMessage);
  const deleteStoredMessage = usePrototypeStore((state) => state.deleteMessageCascade);
  const runAction = (action: 'copy' | 'share' | 'reply' | 'edit' | 'regenerate' | 'delete') => {
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
      Alert.alert('Delete message?', 'This message will be removed from the conversation.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          if (!containingChat) return;
          deleteStoredMessage(containingChat.id, message.id);
          void deleteServerMessage(message.id).catch((error) => Alert.alert('Couldn’t delete message', error instanceof Error ? error.message : undefined));
        } },
      ]);
      return;
    }
    if (action === 'edit' && containingChat) {
      if (Platform.OS === 'ios') {
        Alert.prompt('Edit message', message.role === 'user' ? 'Saving resends from this point in the conversation.' : 'Saving creates a response branch.', (text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const stored = containingChat.messages.find((candidate) => candidate.id === message.id);
          void editServerMessage(message.id, trimmed).catch((error) => Alert.alert('Couldn’t edit message', error instanceof Error ? error.message : undefined));
          if (message.role === 'assistant' && stored) {
            const branches = stored.branches?.length ? [...stored.branches] : [{ id: `${stored.id}-original`, text: stored.text, modelId: stored.modelId ?? containingChat.modelId, createdAt: stored.createdAt }];
            branches.push({ id: `${stored.id}-edit-${Date.now()}`, text: trimmed, modelId: stored.modelId ?? containingChat.modelId, createdAt: Date.now() });
            updateStoredMessage(containingChat.id, message.id, { text: trimmed, branches, activeBranch: branches.length - 1 });
          } else updateStoredMessage(containingChat.id, message.id, { text: trimmed });
        }, 'plain-text', message.text);
      }
      return;
    }
    if (action === 'regenerate' && containingChat) {
      void regenerateServerResponse(message.id).then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch((error) => Alert.alert('Couldn’t regenerate response', error instanceof Error ? error.message : undefined));
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
  };

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
            : <SwiftUIButton label="Regenerate response" systemImage="arrow.clockwise" onPress={() => runAction('regenerate')} />}
          <SwiftUIButton label="Delete message" role="destructive" systemImage="trash" onPress={() => runAction('delete')} />
        </>
      )}
    >
      {children}
    </NativeObjectContextMenu>
  );
}

function SentAttachmentContextMenu({ attachment, children }: { attachment: Attachment; children: ReactNode }) {
  const shareAttachment = () => {
    if (attachment.uri) void Share.share({ message: attachment.name, url: attachment.uri });
    else void shareServerAttachment(attachment.id, attachment.name, attachment.mimeType).catch((error) => Alert.alert('Couldn’t share attachment', error instanceof Error ? error.message : undefined));
  };
  const saveAttachment = () => {
    if (attachment.uri) void Share.share({ message: attachment.name, url: attachment.uri });
    else void downloadAttachment(attachment.id, attachment.name).then(() => AccessibilityInfo.announceForAccessibility('Attachment saved')).catch((error) => Alert.alert('Couldn’t save attachment', error instanceof Error ? error.message : undefined));
  };
  return (
    <NativeObjectContextMenu
      style={attachment.kind === 'image' ? styles.sentImageContextHost : styles.sentFileContextHost}
      preview={attachment.kind === 'image' ? (
        <Image accessibilityLabel={attachment.name} source={{ uri: attachment.uri }} style={styles.attachmentContextImagePreview} />
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
            <SwiftUIButton label="Copy" systemImage="doc.on.doc" onPress={() => void copyText(attachment.uri, 'Attachment link copied')} />
            <SwiftUIButton label="Remove" role="destructive" systemImage="trash" onPress={() => Alert.alert('Remove attachment?', attachment.name)} />
          </SwiftUIControlGroup>
          <SwiftUIDivider />
          <SwiftUIButton label={attachment.kind === 'image' ? 'Save image' : 'Save to Files'} systemImage="square.and.arrow.down" onPress={saveAttachment} />
          <SwiftUIButton label="Attachment info" systemImage="info.circle" onPress={() => Alert.alert(attachment.name, `${attachment.mimeType}\n${formatAttachmentSize(attachment.size)}`)} />
        </>
      )}
    >
      {children}
    </NativeObjectContextMenu>
  );
}

function ReasoningContextMenu({
  message,
  expanded,
  onToggle,
}: {
  message: Message;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { setShowReasoning } = useAppPreferences();
  const reasoning = message.reasoning || `Worked for ${message.thinkSeconds ?? 0}s`;
  const content = (
    <View>
      <Pressable
        accessibilityLabel={`Work details, ${message.thinkSeconds} seconds`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.reasoningTrigger}
      >
        <Icon name="brain.head.profile" size={14} color={COLORS.muted} />
        <Text style={styles.reasoningLabel}>Worked for {message.thinkSeconds}s</Text>
        <Icon name={expanded ? 'chevron.up' : 'chevron.right'} size={10} color={COLORS.dim} weight="semibold" />
      </Pressable>
      {expanded && (
        <View style={styles.reasoningBody}>
          <Text style={styles.reasoningText}>{message.reasoning}</Text>
          <Text style={styles.reasoningDuration}>{message.thinkSeconds}s</Text>
        </View>
      )}
    </View>
  );
  return (
    <NativeObjectContextMenu
      style={styles.reasoningContextHost}
      preview={(
        <View style={styles.reasoningContextPreview}>
          <Text style={styles.reasoningContextPreviewTitle}>WORK · {message.thinkSeconds}s</Text>
          <Text numberOfLines={10} style={styles.reasoningContextPreviewText}>{reasoning}</Text>
        </View>
      )}
      items={(
        <>
          <SwiftUIControlGroup>
            <SwiftUIButton label="Copy" systemImage="doc.on.doc" onPress={() => void copyText(reasoning, 'Work details copied')} />
            <SwiftUIButton label="Share" systemImage="square.and.arrow.up" onPress={() => void Share.share({ message: reasoning })} />
            <SwiftUIButton label="Hide" systemImage="eye.slash" onPress={() => setShowReasoning(false)} />
          </SwiftUIControlGroup>
          <SwiftUIDivider />
          <SwiftUIButton label={expanded ? 'Collapse work' : 'Expand work'} systemImage={expanded ? 'chevron.up' : 'chevron.down'} onPress={onToggle} />
        </>
      )}
    >
      {content}
    </NativeObjectContextMenu>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  model,
  reasoningOpen,
  onToggleReasoning,
}: {
  message: Message;
  model: Model;
  reasoningOpen: boolean;
  onToggleReasoning: (messageId: string) => void;
}) {
  const { showReasoning } = useAppPreferences();
  const containingChat = usePrototypeStore((state) => state.chats.find((chat) => chat.messages.some((candidate) => candidate.id === message.id)));
  const updateStoredMessage = usePrototypeStore((state) => state.updateMessage);
  const storedMessage = containingChat?.messages.find((candidate) => candidate.id === message.id);
  const branches = storedMessage?.branches ?? [];
  const branchIndex = storedMessage?.activeBranch ?? 0;
  return (
    <View style={message.role === 'user' ? styles.userRow : styles.assistantRow}>
      {message.role === 'user' ? (
        <View style={styles.userMessageContent}>
          {message.attachments && message.attachments.length > 0 && (
            <View style={styles.sentAttachments}>
              {message.attachments.map((attachment) => (
                <SentAttachmentContextMenu attachment={attachment} key={attachment.id}>
                  {attachment.kind === 'image' ? (
                    <Image accessibilityLabel={attachment.name} source={{ uri: attachment.uri }} style={styles.sentAttachmentImage} />
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
            <MessageContextMenu message={message}>
              <View style={styles.userBubble}>
                <Text style={styles.messageText}>{message.text}</Text>
              </View>
            </MessageContextMenu>
          )}
        </View>
      ) : (
        <View>
          <View style={styles.assistantHeader}>
            <ModelMark model={model} size={26} />
            <Text style={styles.assistantName}>{model.name}</Text>
            <Text style={styles.messageTime}>now</Text>
          </View>
          {showReasoning && message.thinkSeconds != null && (
            <ReasoningContextMenu
              expanded={reasoningOpen}
              message={message}
              onToggle={() => onToggleReasoning(message.id)}
            />
          )}
          {message.text ? (
            <MessageContextMenu message={message}>
              <Text style={styles.assistantText}>{message.text}</Text>
            </MessageContextMenu>
          ) : message.meta ? (
            <View style={styles.responseError}><Icon name="exclamationmark.triangle" size={15} color="#FF6961" /><Text style={styles.responseErrorText}>{message.meta}</Text></View>
          ) : null}
          {message.text && message.meta && <Text style={styles.messageMeta}>{message.meta}</Text>}
          {branches.length > 1 && containingChat && (
            <View style={styles.branchControls}>
              <IconAction icon="chevron.left" label="Previous branch" onPress={() => {
                const next = Math.max(0, branchIndex - 1);
                updateStoredMessage(containingChat.id, message.id, { activeBranch: next, text: branches[next]!.text });
                void activateServerBranch(branches[next]!.id);
              }} />
              <Text style={styles.branchLabel}>{branchIndex + 1} / {branches.length}</Text>
              <IconAction icon="chevron.right" label="Next branch" onPress={() => {
                const next = Math.min(branches.length - 1, branchIndex + 1);
                updateStoredMessage(containingChat.id, message.id, { activeBranch: next, text: branches[next]!.text });
                void activateServerBranch(branches[next]!.id);
              }} />
            </View>
          )}
        </View>
      )}
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
      <ThinkingLabel label="Responding…" />
      <Text accessible={false} style={[styles.assistantText, styles.draftText]}>{draft}<BlinkingCaret /></Text>
    </View>
  );
});

function NativeModelMenu({ model, models, onSelectModel }: { model: Model; models: Model[]; onSelectModel: (model: Model) => void }) {
  const [section, setSection] = useState<ModelSection>('Favorites');
  const prototypeModels = usePrototypeStore((state) => state.models);
  const defaultModelId = usePrototypeStore((state) => state.defaultModelId);
  const setDefaultModel = usePrototypeStore((state) => state.setDefaultModel);
  const toggleFavoriteModel = usePrototypeStore((state) => state.toggleFavoriteModel);
  const currentPrototypeModel = prototypeModels.find((candidate) => candidate.name === model.name);
  const modelSections: ModelSection[] = ['Favorites', ...new Set(models.map((candidate) => candidate.lab))];
  const visibleModels = section === 'Favorites'
    ? models.filter((candidate) => prototypeModels.find((prototype) => prototype.name === candidate.name)?.favorite)
    : models.filter((candidate) => candidate.lab === section);

  return (
    <SwiftUIHost key={model.name} matchContents style={styles.modelMenuHost}>
      <SwiftUIMenu
        label={(
          <SwiftUILabel
            title={model.name}
            icon={(
              <SwiftUIImage
                uiImage={Image.resolveAssetSource(model.menuIcon ?? model.icon).uri}
                modifiers={[resizable(), frame({ width: 22, height: 22 })]}
              />
            )}
          />
        )}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('capsule'),
          controlSize('regular'),
          swiftUIAccessibilityLabel(`Model, ${model.name}`),
          swiftUIAccessibilityHint('Opens models and lab sections'),
        ]}
      >
        <SwiftUISection title={section}>
          {visibleModels.map((candidate) => (
            <SwiftUIButton
              key={candidate.name}
              onPress={() => onSelectModel(candidate)}
            >
              <NativeModelMenuRow
                label={candidate.name}
                model={candidate}
                selected={candidate.name === model.name}
              />
            </SwiftUIButton>
          ))}
        </SwiftUISection>
        <SwiftUIDivider />
        <SwiftUIMenu
          label={section}
          systemImage={section === 'Favorites' ? 'star.fill' : 'square.grid.2x2'}
        >
          {modelSections.map((candidateSection) => (
            <SwiftUIButton
              key={candidateSection}
              modifiers={[menuActionDismissBehavior('disabled')]}
              onPress={() => {
                setSection(candidateSection);
                Haptics.selectionAsync();
              }}
            >
              <NativeModelSectionRow
                label={candidateSection}
                section={candidateSection}
                models={models}
                selected={candidateSection === section}
              />
            </SwiftUIButton>
          ))}
        </SwiftUIMenu>
        <SwiftUIMenu label="Current model actions" systemImage="slider.horizontal.3">
          <SwiftUIButton
            label="Set as default"
            systemImage={defaultModelId === currentPrototypeModel?.id ? 'checkmark' : 'checkmark.circle'}
            onPress={() => {
              if (currentPrototypeModel) setDefaultModel(currentPrototypeModel.id);
              Haptics.selectionAsync();
            }}
          />
          <SwiftUIToggle
            isOn={Boolean(currentPrototypeModel?.favorite)}
            label="Favorite"
            systemImage="star"
            onIsOnChange={(favorite) => {
              if (currentPrototypeModel && favorite !== currentPrototypeModel.favorite) toggleFavoriteModel(currentPrototypeModel.id);
              Haptics.selectionAsync();
            }}
          />
          <SwiftUIButton
            label="Model information"
            systemImage="info.circle"
            onPress={() => Alert.alert(model.name, `${model.lab}\n${model.detail}`)}
          />
        </SwiftUIMenu>
      </SwiftUIMenu>
    </SwiftUIHost>
  );
}

function NativeModelMenuRow({ label, model, selected = false }: { label: string; model: Model; selected?: boolean }) {
  return (
    <SwiftUIHStack modifiers={[frame({ width: 220 })]} spacing={10}>
      <SwiftUILabel
        title={label}
        icon={<SwiftUIImage uiImage={Image.resolveAssetSource(model.menuIcon ?? model.icon).uri} modifiers={[resizable(), frame({ width: 20, height: 20 })]} />}
      />
      <SwiftUISpacer />
      {selected && <SwiftUIImage systemName="checkmark" size={15} />}
    </SwiftUIHStack>
  );
}

function NativeModelSectionRow({ label, section, models, selected = false }: { label: string; section: ModelSection; models: Model[]; selected?: boolean }) {
  const labModel = section === 'Favorites' ? null : models.find((model) => model.lab === section);
  return (
    <SwiftUIHStack modifiers={[frame({ width: 220 })]} spacing={10}>
      <SwiftUILabel
        title={label}
        icon={labModel
          ? <SwiftUIImage uiImage={Image.resolveAssetSource(labModel.labIcon ?? labModel.icon).uri} modifiers={[resizable(), frame({ width: 20, height: 20 })]} />
          : <SwiftUIImage systemName="star.fill" size={18} />}
      />
      <SwiftUISpacer />
      {selected && <SwiftUIImage systemName="checkmark" size={15} />}
    </SwiftUIHStack>
  );
}

function ChatView({
  messages, chatId, chatTitle, model, models, input, onChangeInput, onSend, assistantStatus, streamingSession,
  onStreamingComplete, onStop, onOpenPanel, onOpenModelPicker, onSelectModel, onNewChat,
}: {
  messages: Message[];
  chatId: string | null;
  chatTitle: string | null;
  model: Model;
  models: Model[];
  input: string;
  onChangeInput: (value: string) => void;
  onSend: (value?: string, attachments?: Attachment[], options?: SendOptions) => boolean;
  assistantStatus: 'idle' | 'thinking' | 'streaming';
  streamingSession: StreamingSession | null;
  onStreamingComplete: (session: StreamingSession) => void;
  onStop: () => void;
  onOpenPanel: () => void;
  onOpenModelPicker: () => void;
  onSelectModel: (model: Model) => void;
  onNewChat: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const accessibilityLayout = fontScale >= 1.6;
  const listRef = useRef<FlatList<Message>>(null);
  const isNearBottom = useRef(true);
  const [reasoningOpen, setReasoningOpen] = useState<Record<string, boolean>>({});
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('Medium');
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [temporary, setTemporary] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [effortPickerOpen, setEffortPickerOpen] = useState(false);
  const demo = usePrototypeStore((state) => state.demo);
  const instanceUrl = usePrototypeStore((state) => state.instance.url);
  const keyboardOffset = useMemo(
    () => ({ closed: 0, opened: Math.max(insets.bottom, 10) - 8 }),
    [insets.bottom],
  );

  const toggleReasoning = useCallback((messageId: string) => {
    Haptics.selectionAsync();
    setReasoningOpen((open) => ({ ...open, [messageId]: !open[messageId] }));
  }, []);

  const openEffortPicker = useCallback(() => {
    Haptics.selectionAsync();
    setEffortPickerOpen(true);
  }, []);

  const toggleAgent = useCallback(() => {
    setAgentEnabled((enabled) => !enabled);
    Haptics.selectionAsync();
  }, []);

  const addAttachments = useCallback((incoming: Attachment[]) => {
    setAttachments((current) => {
      const known = new Set(current.map((attachment) => attachment.uri));
      return [...current, ...incoming.filter((attachment) => !known.has(attachment.uri))].slice(0, 6);
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const pickPhotos = useCallback(async () => {
    if (demo.photos === 'denied') {
      Alert.alert('Photos access is off', 'Allow Pulpo to select images in iOS Settings, or choose a file instead.', [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings' }]);
      return;
    }
    if (demo.fileQuota === 'full') {
      Alert.alert('Storage allowance reached', 'Remove cached files or ask your workspace administrator for more storage.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        quality: 0.9,
        selectionLimit: 6,
      });
      if (result.canceled) return;
      addAttachments(result.assets.map((asset, index) => ({
        id: `photo-${Date.now()}-${index}`,
        kind: 'image' as const,
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `Photo ${index + 1}`,
        size: asset.fileSize,
        uri: asset.uri,
      })));
    } catch {
      Alert.alert('Couldn’t open Photos', 'Please try again or choose the image from Files.');
    }
  }, [addAttachments, demo.fileQuota, demo.photos]);

  const pickFiles = useCallback(async () => {
    if (demo.fileQuota === 'full') {
      Alert.alert('Storage allowance reached', 'This workspace has used its full file allowance.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: ['application/pdf', 'text/*', 'image/*', 'application/json', 'application/vnd.openxmlformats-officedocument.*'],
      });
      if (result.canceled) return;
      addAttachments(result.assets.map((asset, index) => ({
        id: `file-${Date.now()}-${index}`,
        kind: asset.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        name: asset.name,
        size: asset.size,
        uri: asset.uri,
      })));
    } catch {
      Alert.alert('Couldn’t open Files', 'Please try choosing the file again.');
    }
  }, [addAttachments, demo.fileQuota]);

  const submitMessage = useCallback(() => {
    if (!onSend(input, attachments, { reasoningEffort, agentEnabled, temporary })) return;
    setAttachments([]);
  }, [agentEnabled, attachments, input, onSend, reasoningEffort, temporary]);

  const shareChat = useCallback(() => {
    if (!chatId) return;
    void shareServerChat(chatId).then((url) => Share.share({ message: `${chatTitle ?? 'Pulpo chat'}\n\n${url}`, url })).catch((error) => Alert.alert('Couldn’t share chat', error instanceof Error ? error.message : undefined));
  }, [chatId, chatTitle]);
  const nativeAgentTint = colorScheme === 'dark' ? '#BF5AF2' : '#AF52DE';
  const nativeAgentForeground = agentEnabled ? '#ffffff' : colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e';

  const trackScrollPosition = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    isNearBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 96;
  }, []);

  const followContentIfNeeded = useCallback(() => {
    if (!isNearBottom.current) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: assistantStatus === 'idle' }));
  }, [assistantStatus]);

  const renderMessage = useCallback(({ item }: { item: Message }) => (
    <MessageRow
      message={item}
      model={model}
      onToggleReasoning={toggleReasoning}
      reasoningOpen={Boolean(reasoningOpen[item.id])}
    />
  ), [model, reasoningOpen, toggleReasoning]);

  const empty = messages.length === 0 && assistantStatus === 'idle';
  const canSend = (input.trim().length > 0 || attachments.length > 0) && assistantStatus === 'idle';

  return (
    <View style={styles.chatRoot}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* Header */}
        <AppHeader>
          <RoundButton icon="line.3.horizontal" accessibilityLabel="Open chats" onPress={onOpenPanel} />
          <View style={styles.modelTriggerWrap}>
            {Platform.OS === 'ios' ? (
              <NativeModelMenu model={model} models={models} onSelectModel={onSelectModel} />
            ) : (
              <Pressable
                accessibilityHint="Opens the model picker"
                accessibilityLabel={`Model, ${model.name}`}
                accessibilityRole="button"
                onPress={onOpenModelPicker}
              >
                <Glass interactive style={styles.modelTrigger}>
                  <ModelMark model={model} size={22} />
                  <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={styles.modelTriggerText}>{model.name}</Text>
                </Glass>
              </Pressable>
            )}
          </View>
          {Platform.OS === 'ios' ? (
            <NativeChatActionsMenu
              temporary={temporary}
              onTemporaryChange={setTemporary}
              onShare={shareChat}
              onNewChat={onNewChat}
            />
          ) : (
            <RoundButton icon="square.and.pencil" accessibilityLabel="New chat" onPress={onNewChat} />
          )}
        </AppHeader>

        {demo.network !== 'online' && (
          <View style={[styles.connectionBanner, demo.network === 'offline' && styles.connectionBannerOffline]}>
            <Icon name={demo.network === 'offline' ? 'wifi.slash' : 'arrow.triangle.2.circlepath'} size={12} color={demo.network === 'offline' ? '#FFB15A' : COLORS.muted} />
            <Text style={styles.connectionBannerText}>{demo.network === 'offline' ? 'Offline · messages will send when Pulpo reconnects' : demo.network === 'slow' ? 'Slow connection · responses may take longer' : 'Reconnecting to Pulpo…'}</Text>
          </View>
        )}

        {temporary && (
          <View accessibilityRole="text" style={styles.temporaryBanner}>
            <Icon name="eye.slash" size={12} color={COLORS.muted} />
            <Text style={styles.temporaryBannerText}>Temporary chat · not saved to history</Text>
          </View>
        )}

        {/* Virtualized conversation that only follows new content while the reader is near the end. */}
        <FlatList
          contentContainerStyle={[styles.conversation, empty && styles.emptyConversation]}
          data={messages}
          initialNumToRender={10}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(message) => message.id}
          ListEmptyComponent={empty ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyModelLine, accessibilityLayout && styles.emptyModelLineAccessible]}>
                <ModelMark model={model} size={48} />
                <Text maxFontSizeMultiplier={2} style={styles.emptyTitle}>{model.name}</Text>
              </View>
              <Text style={styles.emptyProvider}>{model.lab}</Text>
              <View style={[styles.suggestionGrid, accessibilityLayout && styles.suggestionGridAccessible]}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    accessibilityHint="Sends this suggestion"
                    accessibilityRole="button"
                    key={suggestion}
                    onPress={() => onSend(suggestion, [], { reasoningEffort, agentEnabled, temporary })}
                    style={({ pressed }) => [styles.suggestionCard, accessibilityLayout && styles.suggestionCardAccessible, pressed && styles.navRowPressed]}
                  >
                    <Text style={styles.suggestionLabel}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          ListFooterComponent={assistantStatus === 'thinking' ? (
            <View accessibilityLiveRegion="polite" style={styles.assistantRow}>
              <View style={styles.assistantHeader}>
                <ModelMark model={model} size={26} />
                <Text style={styles.assistantName}>{model.name}</Text>
                <Text style={styles.messageTime}>now</Text>
              </View>
              <ThinkingLabel label="Working…" />
            </View>
          ) : streamingSession ? (
            <StreamingResponse key={streamingSession.id} model={model} onComplete={onStreamingComplete} session={streamingSession} />
          ) : null}
          ListHeaderComponent={!empty ? (
            <Text maxFontSizeMultiplier={1.5} style={styles.dateLabel}>{(chatTitle ?? 'NEW CHAT').toUpperCase()}</Text>
          ) : null}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onContentSizeChange={followContentIfNeeded}
          onScroll={trackScrollPosition}
          ref={listRef}
          renderItem={renderMessage}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.flex}
        />

        <KeyboardStickyView offset={keyboardOffset}>
          <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <View style={styles.composer}>
              <AttachmentStrip
                attachments={attachments}
                onRemove={(id) => {
                  setAttachments((current) => current.filter((attachment) => attachment.id !== id));
                  Haptics.selectionAsync();
                }}
              />
              <TextInput
                accessibilityLabel="Message"
                multiline
                maxLength={2000}
                onChangeText={onChangeInput}
                placeholder={attachments.length > 0 ? 'Add a caption…' : 'Message…'}
                placeholderTextColor={COLORS.dim}
                style={styles.input}
                value={input}
              />
              <View style={styles.composerBar}>
                {Platform.OS === 'ios' ? (
                  <NativeAttachmentMenu onPickFiles={pickFiles} onPickPhotos={pickPhotos} />
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
                {Platform.OS === 'ios' ? (
                  <SwiftUIHost ignoreSafeArea="keyboard" matchContents style={styles.effortMenuHost}>
                    <SwiftUIMenu
                      label={reasoningEffort}
                      modifiers={[
                        buttonStyle('glass'),
                        buttonBorderShape('capsule'),
                        controlSize('regular'),
                        swiftUIAccessibilityLabel(`Reasoning effort, ${reasoningEffort}`),
                        swiftUIAccessibilityHint('Opens reasoning effort choices'),
                      ]}
                    >
                      {REASONING_EFFORTS.map((effort) => (
                        <SwiftUIButton
                          key={effort}
                          label={effort}
                          systemImage={effort === reasoningEffort ? 'checkmark' : undefined}
                          onPress={() => {
                            setReasoningEffort(effort);
                            Haptics.selectionAsync();
                          }}
                        />
                      ))}
                    </SwiftUIMenu>
                  </SwiftUIHost>
                ) : (
                  <Pressable
                    accessibilityHint="Opens reasoning effort choices"
                    accessibilityLabel={`Reasoning effort, ${reasoningEffort}`}
                    accessibilityRole="button"
                    onPress={openEffortPicker}
                    style={({ pressed }) => [styles.effortPill, pressed && styles.pressed]}
                  >
                    <Text maxFontSizeMultiplier={1.4} style={styles.effortText}>{reasoningEffort}</Text>
                  </Pressable>
                )}
                <View style={styles.flex} />
                {Platform.OS === 'ios' ? (
                  <>
                    <SwiftUIHost ignoreSafeArea="keyboard" style={styles.nativeAgentHost}>
                      <SwiftUIButton
                        onPress={() => {
                          setAgentEnabled(!agentEnabled);
                          Haptics.selectionAsync();
                        }}
                        modifiers={[
                          buttonStyle(agentEnabled ? 'glassProminent' : 'glass'),
                          buttonBorderShape('circle'),
                          controlSize('regular'),
                          tint(nativeAgentTint),
                          swiftUIAccessibilityLabel('Agent mode'),
                          swiftUIAccessibilityHint(agentEnabled ? 'On. Double tap to turn off.' : 'Off. Double tap to turn on.'),
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
                      label={assistantStatus !== 'idle' ? 'Stop generating' : 'Send message'}
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
                      accessibilityState={{ checked: agentEnabled }}
                      onPress={toggleAgent}
                      style={({ pressed }) => [styles.agentCircle, agentEnabled && styles.agentCircleActive, pressed && styles.pressed]}
                    >
                      <Bot color={agentEnabled ? COLORS.foregroundOnAccent : COLORS.muted} size={13} strokeWidth={2} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={assistantStatus !== 'idle' ? 'Stop generating' : 'Send message'}
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
            </View>
          </View>
        </KeyboardStickyView>
        <ReasoningEffortSheet
          selected={reasoningEffort}
          visible={effortPickerOpen}
          onClose={() => setEffortPickerOpen(false)}
          onSelect={(effort) => {
            setReasoningEffort(effort);
            setEffortPickerOpen(false);
            Haptics.selectionAsync();
          }}
        />
      </SafeAreaView>
    </View>
  );
}

function ReasoningEffortSheet({
  visible,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selected: ReasoningEffort;
  onClose: () => void;
  onSelect: (effort: ReasoningEffort) => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.optionModal}>
        <Pressable accessibilityLabel="Close reasoning effort picker" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.optionSheet}>
          <Text accessibilityRole="header" style={styles.optionTitle}>Reasoning effort</Text>
          <Text style={styles.optionSubtitle}>Choose how much time the model should spend reasoning.</Text>
          {REASONING_EFFORTS.map((effort) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: effort === selected }}
              key={effort}
              onPress={() => onSelect(effort)}
              style={({ pressed }) => [styles.optionRow, pressed && styles.navRowPressed]}
            >
              <Text style={styles.optionRowText}>{effort}</Text>
              {effort === selected && <Icon name="checkmark" size={16} color={COLORS.accent} weight="semibold" />}
            </Pressable>
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
        modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, minHeight: DRAWER_ACTION_HEIGHT }), swiftUIAccessibilityLabel('Search chats')]}
      >
        <SwiftUIHStack spacing={12}>
          <SwiftUIImage systemName="magnifyingglass" size={17} modifiers={[frame({ width: 20, height: 20 }), foregroundStyle('primary')]} />
          <SwiftUIText modifiers={[font({ textStyle: 'body' }), foregroundStyle('secondary')]}>Search chats</SwiftUIText>
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
    <SwiftUIButton onPress={onPress} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), frame({ maxWidth: Infinity, minHeight: 46 }), swiftUIAccessibilityLabel(value ? `${label}, ${value}` : label)]}>
      <SwiftUIHStack spacing={12}><SwiftUIImage systemName={icon} size={17} modifiers={[frame({ width: 20, height: 20 })]} /><SwiftUIText>{label}</SwiftUIText><SwiftUISpacer />{value ? <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{value}</SwiftUIText> : null}</SwiftUIHStack>
    </SwiftUIButton>
  </SwiftUIHost>;
}

function NativeFoldersDisclosure({ folders, onCreate, onSelectChat }: {
  folders: Array<{ id: string; name: string; chats: Chat[] }>;
  onCreate: () => void;
  onSelectChat: (chat: Chat) => void;
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
          <SwiftUIButton onPress={() => { Haptics.selectionAsync(); setExpanded((current) => !current); }} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), frame({ maxWidth: Infinity, minHeight: DRAWER_ACTION_HEIGHT }), swiftUIAccessibilityLabel(`Folders, ${folders.length}, ${expanded ? 'expanded' : 'collapsed'}`)]}>
            <SwiftUIHStack spacing={12}>
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
            <SwiftUIButton onPress={() => { Haptics.selectionAsync(); setExpandedFolders((current) => ({ ...current, [folder.id]: !folderExpanded })); }} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), padding({ leading: 24 }), frame({ maxWidth: Infinity, minHeight: 40 }), swiftUIAccessibilityLabel(`${folder.name}, ${folder.chats.length} chats, ${folderExpanded ? 'expanded' : 'collapsed'}`)]}>
              <SwiftUIHStack spacing={10}>
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
                <SwiftUIButton onPress={() => onSelectChat(chat)} modifiers={[buttonStyle('plain'), foregroundStyle('primary'), padding({ leading: 48 }), frame({ maxWidth: Infinity, minHeight: 38 }), swiftUIAccessibilityLabel(`Open ${chat.title}`)]}>
                  <SwiftUIHStack spacing={10}><SwiftUIImage systemName="bubble.left" size={14} modifiers={[frame({ width: 20, height: 20 }), foregroundStyle('secondary')]} /><SwiftUIText>{chat.title}</SwiftUIText><SwiftUISpacer /></SwiftUIHStack>
                </SwiftUIButton>
              </SwiftUIHost>
            ) : <SwiftUIHost ignoreSafeArea="all" style={styles.nativeFolderEmptyRowHost}><SwiftUIHStack modifiers={[padding({ leading: 78 }), frame({ maxWidth: Infinity, minHeight: 34 })]}><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>No chats yet</SwiftUIText><SwiftUISpacer /></SwiftUIHStack></SwiftUIHost>}
          </Reanimated.View> : null}
        </Reanimated.View>;
      })}
      <SwiftUIHost ignoreSafeArea="all" style={styles.nativeFolderRowHost}>
        <SwiftUIButton onPress={onCreate} modifiers={[buttonStyle('plain'), foregroundStyle('secondary'), padding({ leading: 24 }), frame({ maxWidth: Infinity, minHeight: 40 }), swiftUIAccessibilityLabel('New folder')]}>
          <SwiftUIHStack spacing={10}><SwiftUIImage systemName="folder.badge.plus" size={15} modifiers={[frame({ width: 20, height: 20 })]} /><SwiftUIText>New folder</SwiftUIText><SwiftUISpacer /></SwiftUIHStack>
        </SwiftUIButton>
      </SwiftUIHost>
    </Reanimated.View> : null}
  </Reanimated.View>;
}

function HistoryPanel({ chats, activeChatId, drawerOpen, onSelectChat, onNewChat, onOpenSettings }: {
  chats: Chat[];
  activeChatId: string | null;
  drawerOpen: boolean;
  onSelectChat: (chat: Chat) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}) {
  const folders = usePrototypeStore((state) => state.folders);
  const storedChats = usePrototypeStore((state) => state.chats);
  const trashChat = usePrototypeStore((state) => state.trashChat);
  const togglePin = usePrototypeStore((state) => state.togglePin);
  const renameChat = usePrototypeStore((state) => state.renameChat);
  const moveChat = usePrototypeStore((state) => state.moveChat);
  const upsertChat = usePrototypeStore((state) => state.upsertChat);
  const addFolder = usePrototypeStore((state) => state.addFolder);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const folderItems = useMemo(() => {
    const folderIdByChat = new Map(storedChats.map((chat) => [chat.id, chat.folderId]));
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      chats: chats.filter((chat) => folderIdByChat.get(chat.id) === folder.id),
    }));
  }, [chats, folders, storedChats]);
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const searchQueryProgress = useSharedValue(search.length > 0 ? 1 : 0);
  const nativeSearchRef = useRef<SwiftUITextFieldRef>(null);
  const dismissSearch = useCallback(() => {
    Keyboard.dismiss();
    void nativeSearchRef.current?.blur();
  }, []);
  useEffect(() => {
    if (!drawerOpen) dismissSearch();
  }, [dismissSearch, drawerOpen]);
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
  const historyHeaderAnimatedStyle = useAnimatedStyle(() => {
    const collapseProgress = Math.max(keyboardProgress.value, searchQueryProgress.value);
    return {
      height: interpolate(collapseProgress, [0, 1], [35, 0]),
      opacity: interpolate(collapseProgress, [0, 0.72], [1, 0]),
      overflow: 'hidden',
      transform: [{ translateY: interpolate(collapseProgress, [0, 1], [0, -18]) }],
    };
  });
  const filtered = useMemo(
    () => chats.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase())),
    [chats, search],
  );
  const sections = useMemo(() => {
    const grouped = new Map<string, Chat[]>();
    filtered.forEach((chat) => grouped.set(chat.section, [...(grouped.get(chat.section) ?? []), chat]));
    return Array.from(grouped, ([title, data]) => ({ title, data }));
  }, [filtered]);

  const runChatAction = (chat: Chat, action: 'share' | 'move' | 'delete' | 'pin' | 'rename' | 'duplicate' | 'archive') => {
    if (action === 'delete') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Delete chat?', `“${chat.title}” will be removed from your history.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Move to Trash', style: 'destructive', onPress: () => trashChat(chat.id) },
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
        const source = storedChats.find((item) => item.id === chat.id);
        upsertChat({ id: copy.id, title: copy.title, modelId: copy.modelId, pinned: copy.pinned, folderId: copy.folderId, temporary: copy.temporary, createdAt: Date.parse(copy.createdAt), updatedAt: Date.parse(copy.updatedAt), deletedAt: null, purgeAt: null, messages: source?.messages ?? [] });
      }).catch((error) => Alert.alert('Couldn’t duplicate chat', error instanceof Error ? error.message : undefined));
      return;
    }
    if (action === 'archive') {
      trashChat(chat.id);
      return;
    }
    const labels = {
      move: 'Move to folder',
      pin: 'Pin chat',
      rename: 'Rename chat',
      duplicate: 'Duplicate chat',
      archive: 'Archive chat',
    } as const;
    Alert.alert(labels[action], `“${chat.title}”`);
  };

  const fallbackChatActions = (chat: Chat) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(chat.title, undefined, [
      { text: 'Rename', onPress: () => runChatAction(chat, 'rename') },
      { text: 'Share', onPress: () => runChatAction(chat, 'share') },
      { text: 'Delete', style: 'destructive', onPress: () => runChatAction(chat, 'delete') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.panelRoot}>
      <SafeAreaView style={[styles.flex, styles.panelContent]} edges={['top', 'bottom']}>
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
            placeholderTextColor={searchFocused ? COLORS.dim : COLORS.textSoft}
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
          {Platform.OS === 'ios' ? <NativeFoldersDisclosure folders={folderItems} onSelectChat={(chat) => { dismissSearch(); onSelectChat(chat); }} onCreate={() => { dismissSearch(); Alert.prompt('New folder', 'Create a folder for related chats.', (name) => name.trim() && addFolder(name)); }} /> : <NativeObjectContextMenu
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
          contentContainerStyle={styles.chatList}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(chat) => chat.id}
          ListEmptyComponent={<Text style={styles.noResults}>No chats match “{search}”</Text>}
          ListHeaderComponent={<Reanimated.View style={historyHeaderAnimatedStyle}><Text style={styles.panelSectionLabel}>Chat history</Text></Reanimated.View>}
          renderItem={({ item: chat }) => Platform.OS === 'ios' ? (
            <SwiftUIHost ignoreSafeArea="all" matchContents style={styles.chatContextMenuHost}>
              <SwiftUIContextMenu>
                <SwiftUIContextMenu.Trigger>
                  <SwiftUIRNHostView matchContents>
                    <Pressable
                      accessibilityHint="Double tap to open. Long press for more actions."
                      accessibilityRole="button"
                      accessibilityState={{ selected: activeChatId === chat.id }}
                      onPress={() => { dismissSearch(); onSelectChat(chat); }}
                      style={({ pressed }) => [styles.chatRow, activeChatId === chat.id && styles.chatRowActive, pressed && styles.navRowPressed]}
                    >
                      <View style={styles.flex}>
                        <Text numberOfLines={1} style={styles.chatTitle}>{chat.title}</Text>
                      </View>
                      <Text style={styles.chatTime}>{chat.time}</Text>
                    </Pressable>
                  </SwiftUIRNHostView>
                </SwiftUIContextMenu.Trigger>
                <SwiftUIContextMenu.Preview>
                  <SwiftUIRNHostView matchContents>
                    <View style={styles.chatContextPreview}>
                      <View style={styles.chatContextPreviewHeader}>
                        <PulpoMark size={32} />
                        <View style={styles.flex}>
                          <Text style={styles.chatContextPreviewEyebrow}>PULPO CHAT</Text>
                          <Text numberOfLines={1} style={styles.chatContextPreviewTitle}>{chat.title}</Text>
                        </View>
                      </View>
                      <Text numberOfLines={4} style={styles.chatContextPreviewBody}>
                        {chat.messages.at(-1)?.text || 'Start a new conversation with your selected model.'}
                      </Text>
                      <Text style={styles.chatContextPreviewMeta}>{chat.section} · {chat.time}</Text>
                    </View>
                  </SwiftUIRNHostView>
                </SwiftUIContextMenu.Preview>
                <SwiftUIContextMenu.Items>
                  <SwiftUIControlGroup>
                    <SwiftUIButton label="Share" systemImage="square.and.arrow.up" onPress={() => runChatAction(chat, 'share')} />
                    <SwiftUIButton label="Move" systemImage="folder" onPress={() => runChatAction(chat, 'move')} />
                    <SwiftUIButton label="Delete" role="destructive" systemImage="trash" onPress={() => runChatAction(chat, 'delete')} />
                  </SwiftUIControlGroup>
                  <SwiftUIDivider />
                  <SwiftUIButton label="Pin chat" systemImage="pin" onPress={() => runChatAction(chat, 'pin')} />
                  <SwiftUIButton label="Rename chat" systemImage="pencil" onPress={() => runChatAction(chat, 'rename')} />
                  <SwiftUIButton label="Duplicate chat" systemImage="plus.square.on.square" onPress={() => runChatAction(chat, 'duplicate')} />
                </SwiftUIContextMenu.Items>
              </SwiftUIContextMenu>
            </SwiftUIHost>
          ) : (
            <Pressable
              accessibilityHint="Double tap to open. Long press for more actions."
              accessibilityRole="button"
              accessibilityState={{ selected: activeChatId === chat.id }}
              delayLongPress={350}
              onLongPress={() => fallbackChatActions(chat)}
              onPress={() => { dismissSearch(); onSelectChat(chat); }}
              style={({ pressed }) => [styles.chatRow, activeChatId === chat.id && styles.chatRowActive, pressed && styles.navRowPressed]}
            >
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.chatTitle}>{chat.title}</Text>
              </View>
              <Text style={styles.chatTime}>{chat.time}</Text>
            </Pressable>
          )}
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
}

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
              accessibilityState={{ selected: selected === model.name }}
              delayLongPress={350}
              key={model.name}
              onLongPress={() => Alert.alert(model.name, 'Set as default · Favorite · Model information')}
              onPress={() => onSelect(model)}
              style={({ pressed }) => [styles.modelRow, pressed && styles.navRowPressed]}
            >
              <ModelMark model={model} size={42} />
              <View style={styles.flex}>
                <Text style={styles.modelRowTitle}>{model.name}</Text>
                <Text style={styles.modelRowDetail}>{model.lab} · {model.detail}</Text>
              </View>
              {selected === model.name
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
          {models.map((model) => <SwiftUIButton key={model.name} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={() => onSelect(model)}><SwiftUIHStack spacing={12}><SwiftUIRNHostView matchContents><View pointerEvents="none" style={styles.nativeModelAssetHost}><ModelMark model={model} size={38} /></View></SwiftUIRNHostView><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText>{model.name}</SwiftUIText><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${model.lab} · ${model.detail}`}</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName={selected === model.name ? 'checkmark.circle.fill' : 'star'} size={18} /></SwiftUIHStack></SwiftUIButton>)}
        </SwiftUISection>
      </SwiftUIForm>
    </SwiftUIGroup>
  </SwiftUIBottomSheet></SwiftUIHost>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: COLORS.panel },

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
  chatRoot: { flex: 1, backgroundColor: COLORS.background },
  appHeader: { height: 64, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  nativeHeaderActionHost: { width: 44, height: 44 },
  roundButton: { alignItems: 'center', justifyContent: 'center' },
  glassFallback: { backgroundColor: COLORS.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line },
  pressed: { opacity: 0.75 },
  modelTriggerWrap: { flex: 1, alignItems: 'center' },
  modelMenuHost: { minHeight: 44, maxWidth: 230, justifyContent: 'center' },
  modelTrigger: { minHeight: 44, maxWidth: 218, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  modelTriggerText: { color: COLORS.text, fontSize: 15, fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  temporaryBanner: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: COLORS.fill, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 2 },
  temporaryBannerText: { color: COLORS.muted, fontSize: 11.5, fontWeight: '500' },
  connectionBanner: { alignSelf: 'center', maxWidth: '92%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: COLORS.fill, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 3 },
  connectionBannerOffline: { backgroundColor: 'rgba(255,159,63,0.12)' },
  connectionBannerText: { color: COLORS.muted, fontSize: 11.5, fontWeight: '600' },
  conversation: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26 },
  emptyConversation: { flexGrow: 1, justifyContent: 'center', paddingBottom: 24 },
  emptyState: { alignItems: 'center' },
  pulpoMark: { shadowColor: COLORS.accent, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
  emptyModelLine: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  emptyModelLineAccessible: { flexDirection: 'column', width: '100%' },
  emptyTitle: { color: COLORS.text, fontSize: 26, fontWeight: '600', letterSpacing: -0.8, textAlign: 'center' },
  emptyProvider: { color: COLORS.muted, fontSize: 13.5, marginTop: 7 },
  dateLabel: { color: COLORS.dim, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.9, alignSelf: 'center', marginBottom: 26, marginTop: 6 },

  userRow: { alignItems: 'flex-end', marginBottom: 30 },
  userMessageContent: { alignItems: 'flex-end', maxWidth: '88%', gap: 7 },
  userMessageContextHost: { maxWidth: '85%', alignSelf: 'flex-end' },
  assistantMessageContextHost: { width: '100%' },
  userBubble: { maxWidth: '100%', backgroundColor: COLORS.secondary, borderRadius: 20, borderBottomRightRadius: 7, paddingHorizontal: 15, paddingVertical: 11 },
  sentAttachments: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  sentImageContextHost: { width: 112, height: 112 },
  sentFileContextHost: { maxWidth: 230, minHeight: 48 },
  sentAttachmentImage: { width: 112, height: 112, borderRadius: 16, backgroundColor: COLORS.fill },
  sentFileAttachment: { maxWidth: 230, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 15, backgroundColor: COLORS.secondary, paddingHorizontal: 12 },
  sentFileName: { color: COLORS.text, fontSize: 13.5, flexShrink: 1 },
  messageText: { color: COLORS.text, fontSize: 15.5, lineHeight: 22.5 },
  messageContextPreview: { width: 320, maxHeight: 360, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 20 },
  messageContextPreviewUser: { backgroundColor: COLORS.secondary },
  messageContextPreviewRole: { color: COLORS.dim, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 },
  messageContextPreviewText: { color: COLORS.text, fontSize: 16, lineHeight: 24 },
  attachmentContextImagePreview: { width: 320, height: 320, borderRadius: 28, backgroundColor: COLORS.elevated },
  attachmentContextFilePreview: { width: 300, minHeight: 180, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 24, alignItems: 'center', justifyContent: 'center' },
  attachmentContextFileName: { color: COLORS.text, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 14 },
  attachmentContextFileMeta: { color: COLORS.muted, fontSize: 12, marginTop: 6 },
  assistantRow: { marginBottom: 32 },
  assistantHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  assistantName: { color: COLORS.textSoft, fontSize: 13.5, fontWeight: '600' },
  messageTime: { color: COLORS.dim, fontSize: 11.5 },
  assistantText: { color: COLORS.textSoft, fontSize: 15.5, lineHeight: 25.5, letterSpacing: -0.1 },
  draftText: { marginTop: 10 },
  caret: { color: COLORS.muted, fontSize: 15.5 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6 },
  thinkingText: { color: COLORS.muted, fontSize: 12.5, fontWeight: '500' },
  reasoningTrigger: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, paddingVertical: 4 },
  reasoningContextHost: { width: '100%' },
  reasoningLabel: { color: COLORS.muted, fontSize: 12.5, fontWeight: '500' },
  reasoningBody: { borderLeftWidth: 2, borderLeftColor: COLORS.line, paddingLeft: 12, marginBottom: 16, marginLeft: 2, gap: 8 },
  reasoningText: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  reasoningDuration: { color: COLORS.dim, fontSize: 11, fontVariant: ['tabular-nums'] },
  reasoningContextPreview: { width: 320, minHeight: 180, maxHeight: 380, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 20 },
  reasoningContextPreviewTitle: { color: COLORS.dim, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.8, marginBottom: 12 },
  reasoningContextPreviewText: { color: COLORS.textSoft, fontSize: 14.5, lineHeight: 21 },
  messageMeta: { color: COLORS.dim, fontSize: 11, marginTop: 12, fontFamily: COLORS.mono, letterSpacing: -0.2 },
  responseError: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,92,92,0.35)', backgroundColor: 'rgba(255,92,92,0.10)', borderRadius: 12, padding: 11, marginTop: 6 },
  responseErrorText: { color: '#FF8A84', flex: 1, fontSize: 12.5, lineHeight: 18 },
  branchControls: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 5 },
  branchLabel: { color: COLORS.dim, fontSize: 11, fontVariant: ['tabular-nums'] },
  iconAction: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  suggestionGrid: { width: '100%', marginTop: 30, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  suggestionGridAccessible: { flexDirection: 'column', flexWrap: 'nowrap' },
  suggestionCard: { width: '48.7%', minHeight: 68, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line, backgroundColor: COLORS.card, paddingHorizontal: 13, paddingVertical: 11, justifyContent: 'center' },
  suggestionCardAccessible: { width: '100%' },
  suggestionLabel: { color: COLORS.textSoft, fontSize: 13, lineHeight: 18 },

  composerWrap: { paddingHorizontal: 12, paddingTop: 6, backgroundColor: COLORS.background },
  composer: { minHeight: 108, borderRadius: 28, paddingTop: 12, paddingHorizontal: 10, paddingBottom: 4, backgroundColor: COLORS.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line },
  attachmentStrip: { maxHeight: 89, marginBottom: 8 },
  attachmentStripContent: { gap: 8, paddingHorizontal: 2 },
  attachmentFrame: { paddingTop: 17, paddingRight: 17 },
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
  optionSheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28 },
  optionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  optionSubtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 14 },
  optionRow: { minHeight: 52, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionRowText: { color: COLORS.text, fontSize: 16, fontWeight: '500' },

  // History panel
  panelRoot: { flex: 1, backgroundColor: COLORS.panel },
  panelContent: { paddingRight: 72 },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  profileName: { color: COLORS.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  searchBox: { height: DRAWER_ACTION_HEIGHT, marginHorizontal: 10, marginTop: 6, borderRadius: 13, backgroundColor: COLORS.card, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  nativeDrawerSearchHost: { height: DRAWER_ACTION_HEIGHT, marginHorizontal: 22, marginTop: 6, borderRadius: 13, backgroundColor: COLORS.card },
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
  navMeta: { color: COLORS.dim, fontSize: 12.5, marginLeft: 'auto' },
  chatList: { paddingHorizontal: 10, paddingBottom: 16 },
  panelSectionLabel: { color: COLORS.dim, fontSize: 13, marginTop: 14, marginBottom: 4, marginHorizontal: 12 },
  sectionLabel: { color: COLORS.dim, fontSize: 11, fontWeight: '600', marginTop: 16, marginBottom: 5, marginHorizontal: 12 },
  chatContextMenuHost: { width: '100%', height: 44 },
  chatRow: { minHeight: 44, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatRowActive: { backgroundColor: COLORS.secondary },
  chatTitle: { color: COLORS.textSoft, fontSize: 15 },
  chatTime: { color: COLORS.dim, fontSize: 12 },
  chatContextPreview: { width: 320, minHeight: 176, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.lineSoft, backgroundColor: COLORS.elevated, padding: 20, justifyContent: 'space-between', overflow: 'hidden' },
  chatContextPreviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  chatContextPreviewEyebrow: { color: COLORS.dim, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.8 },
  chatContextPreviewTitle: { color: COLORS.text, fontSize: 18, fontWeight: '600', letterSpacing: -0.35, marginTop: 2 },
  chatContextPreviewBody: { color: COLORS.textSoft, fontSize: 14.5, lineHeight: 20, marginTop: 18 },
  chatContextPreviewMeta: { color: COLORS.muted, fontSize: 11.5, marginTop: 16 },
  noResults: { color: COLORS.dim, fontSize: 13.5, textAlign: 'center', marginTop: 30 },
  // Model sheet
  nativeModalAnchorHost: { position: 'absolute', width: 1, height: 1, right: 0, top: 0 },
  nativeModelAssetHost: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, backgroundColor: COLORS.background },
  sheetSafe: { flex: 1, paddingHorizontal: 18 },
  sheetGrabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: COLORS.fillStrong, alignSelf: 'center', marginTop: 8, marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sheetTitle: { color: COLORS.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  sheetSubtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4 },
  sheetClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center' },
  sheetSection: { color: COLORS.dim, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.7, marginTop: 24, marginBottom: 6, marginLeft: 3 },
  modelRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.lineSoft, borderRadius: 8, paddingHorizontal: 3 },
  modelRowTitle: { color: COLORS.text, fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2 },
  modelRowDetail: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  sheetFootnote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, paddingHorizontal: 3 },
  sheetFootnoteText: { color: COLORS.dim, fontSize: 11.5, flex: 1, lineHeight: 16 },

  smallIconButton: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
});
