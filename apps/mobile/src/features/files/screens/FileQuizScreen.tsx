import { parseQuiz } from '@pulpo/client-core/quiz'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useQuery } from '@tanstack/react-query'
import { File } from 'expo-file-system'
import { useLayoutEffect, useMemo } from 'react'
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RootStackParamList } from '../../../mockup5/src/navigation'
import { PageHeader } from '../../../mockup5/src/components/PrototypeUI'
import { MaterialIconButton } from '../../../platform/MaterialUI'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import { QuizCard } from '../../quiz/QuizCard'
import { downloadFile } from '../api'
import { useFilesEnabled } from '../availability'
import { FilesTurnedOff } from '../components/FilesTurnedOff'
import { filesErrorMessage } from '../display'
import { shareFileItem } from '../open'
import { fileNodeQuery, filesQueryKeys } from '../queries'
import { useFilesNamespace } from '../useFilesNamespace'

type Props = NativeStackScreenProps<RootStackParamList, 'FileQuiz'>

/** A `.quiz` file, taken in the app: from Files, or a chat attachment already on the device. */
export function FileQuizScreen({ navigation, route }: Props) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const namespace = useFilesNamespace()
  const filesEnabled = useFilesEnabled()
  const fileId = 'fileId' in route.params ? route.params.fileId : null
  const uri = 'uri' in route.params ? route.params.uri : null
  const nodeQuery = useQuery({ ...fileNodeQuery(namespace, fileId ?? ''), enabled: Boolean(namespace && fileId) && filesEnabled })
  const node = nodeQuery.data?.node
  const content = useQuery({
    queryKey: fileId ? [...filesQueryKeys.node(namespace, fileId), 'content', node?.updatedAt ?? ''] : ['quiz-file', uri],
    queryFn: async () => fileId ? (await downloadFile(node!)).text() : new File(uri!).text(),
    enabled: fileId ? node?.kind === 'blob' && filesEnabled : true,
  })
  const quiz = useMemo(() => content.data === undefined ? undefined : parseQuiz(content.data), [content.data])
  const name = node?.name ?? route.params.name ?? 'Quiz'
  const unavailable = Boolean(fileId) && !filesEnabled
  // A file in Files is shared as it is; an attachment's card offers sharing and saving it.
  const share = node && filesEnabled ? () => {
    void shareFileItem(node).catch((error) => Alert.alert('Couldn’t share', filesErrorMessage(error)))
  } : null

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerShown: Platform.OS === 'ios',
      headerBackTitle: 'Back',
      unstable_headerRightItems: Platform.OS === 'ios' && share ? () => [
        { type: 'button', label: 'Share', icon: { type: 'sfSymbol', name: 'square.and.arrow.up' }, onPress: share },
      ] : undefined,
    })
  })

  return (
    <View style={[styles.flex, { backgroundColor: theme.isDark ? theme.background : theme.elevated, paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
      {Platform.OS === 'android' ? (
        <PageHeader title={name} onBack={() => navigation.goBack()} right={share ? <MaterialIconButton icon="square.and.arrow.up" label="Share" onPress={share} /> : null} />
      ) : null}
      {unavailable ? <FilesTurnedOff /> : quiz ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <QuizCard exportable={!fileId} progressKey={content.data!} quiz={quiz} />
        </ScrollView>
      ) : quiz === null || content.isError || nodeQuery.isError ? (
        <View style={styles.center}>
          <SymbolView name="exclamationmark.triangle" size={36} tintColor={theme.tertiary} />
          <Text style={[styles.centerText, { color: theme.secondary }]}>
            {quiz === null ? 'This file isn’t a quiz that can be shown.' : filesErrorMessage(content.error ?? nodeQuery.error)}
          </Text>
        </View>
      ) : <View style={styles.center}><ActivityIndicator color={theme.secondary} /></View>}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  centerText: { fontSize: 15, textAlign: 'center' },
})
