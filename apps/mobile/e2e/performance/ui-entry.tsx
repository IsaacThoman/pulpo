// Synthetic Release UI smoke fixture. Never imported by the normal application.
import React, { useEffect, useState } from 'react'
import { registerRootComponent } from 'expo'
import { Pressable, Text, View } from 'react-native'
import { usePrototypeStore } from '../../src/mockup5/src/store/prototypeStore'
import { AppProviders } from '../../src/providers/AppProviders'
import App from '../../src/mockup5/App'
import { configureApi, mobileApi } from '../../src/api/client'
import { useSessionStore } from '../../src/store/session'
import { usePreferencesStore } from '../../src/store/preferences'
import { cacheChats, cacheNamespace, clearNamespace, recordCachedAttachment, setValue } from '../../src/data/database'
import { withoutCachedChatDetails } from '../../src/data/cache'
import { activeChatSubscription, useRealtimeStore } from '../../src/providers/realtimeStore'
import { File, Paths } from 'expo-file-system'
import type { MobileModel, User, ServerChat } from '../../src/types'
import { fixture } from './fixture'

const origin = 'https://127.0.0.1:1'
const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Performance fixture', email: 'fixture@example.invalid', role: 'user', stateRevision: 0 } as User
const namespace = cacheNamespace(origin, user.id)
const coverFixture = process.env.EXPO_PUBLIC_PERF_COLD_CHAT === '1'
const chats: ServerChat[] = Array.from({ length: 20 }, (_, i) => ({
  ...fixture(i === 0 ? 1000 : i === 1 ? 1 : i === 3 && coverFixture ? 0 : 100, 256, `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`),
  title: i === 0 ? 'Performance 1000 turns' : `Performance chat ${i + 1}`,
  sortOrder: i,
}))
// Exercise large accounts without retaining thousands of synthetic transcripts.
const historyCount = Number(process.env.EXPO_PUBLIC_PERF_HISTORY_COUNT ?? 20)
const coldChatId = coverFixture ? chats[2]!.id : null
for (let i = chats.length; i < historyCount; i++) {
  chats.push({ ...withoutCachedChatDetails(chats[1]!),
    id: `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
    title: `Performance chat ${i + 1}`, sortOrder: i })
}
const model = { id: 'fixture', name: 'Fixture model', description: 'Synthetic local test', executionMode: 'stream', maxOutputTokens: 4096, agentEnabled: false, tags: [], logo: null, iconLight: null, iconDark: null, provider: { id: 'fixture', name: 'Fixture' }, lab: null, presets: [] } as MobileModel
configureApi({ instanceUrl: origin, token: null })
mobileApi.chats = async () => ({ data: chats.map(withoutCachedChatDetails) })
mobileApi.chat = async (id) => {
  await new Promise((resolve) => setTimeout(resolve, id === coldChatId ? 5000 : 1000))
  return chats.find((chat) => chat.id === id)!
}
mobileApi.deletedChats = async () => ({ data: [] })
mobileApi.models = async () => ({ data: [model], agentAvailable: false })
mobileApi.folders = async () => ({ data: [] })
mobileApi.settings = async () => ({ values: {}, updatedAt: null })
useSessionStore.setState({ status: 'authenticated', user, token: null, instanceUrl: origin, hydrate: async () => {} })
usePreferencesStore.setState({ hydrated: true, hydrate: async () => {} })

async function seed() {
  await clearNamespace(namespace)
  const picture = new File(Paths.document, 'fixture.png')
  // A small synthetic PNG: no remote image requests or private files.
  picture.write('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAw0lEQVR4nO3WsQ2AMBDF0AzBiIzITFkDmICUTxEurjtLlqs/jvO6v24ubnd+aAHNF0ALaL4AWkDzBdACmh/HfB8/bi5ud74AWkDzBdACmi+AFtB8AfQQ0XwBtIDmC6AFNF8ALaD5AughovkCaAHNF0ALaL4AWkDzBdBDRPMF0AKaL4AW0HwBtIDmC6CHiOYLoAU0XwAtoPkCaAHNF0APEc0XQAtovgBaQPMF0AKaL4AeIpovgBbQfAG0gOYLoAU0//sAD6yIUqTz1dbpAAAAAElFTkSuQmCC', { encoding: 'base64' })
  const attachment = { id: '00000000-0000-4000-8000-000000009999', originalName: 'fixture.png', mimeType: 'image/png', sizeBytes: picture.size }
  picture.copy(new File(Paths.cache, `${attachment.id}-thumbnail.webp`), { overwrite: true })
  const long = chats[0]!
  long.attachments = [attachment]
  const response = long.responses!.at(-1)!
  response.input = [{ role: 'user', content: [{ type: 'input_text', text: 'Open the synthetic gallery image' }, { type: 'input_file', attachment_id: attachment.id }] }]
  const output = [{ type: 'message', content: [{ type: 'output_text', text: '## Native Markdown\n\nThis is the last answer in a **1,000-turn** conversation.\n\n- Scroll through history\n- Type while streaming\n- Open the image gallery\n\n```ts\nconst ready = true\n```' }] }]
  response.output = output; response.snapshot = { ...response.snapshot, output }
  const short = chats[1]!
  short.attachments = [attachment]
  short.responses![0]!.input = response.input
  short.responses![0]!.output = output
  short.responses![0]!.snapshot = { ...short.responses![0]!.snapshot, output }
  await recordCachedAttachment(namespace, attachment.id, picture.uri, picture.size, 10 * 1024 * 1024)
  await cacheChats(namespace, chats.map((chat) => chat.id === coldChatId ? withoutCachedChatDetails(chat) : chat))
  await setValue(namespace, 'model-catalog', { data: [model], agentAvailable: false })
}
export default function FixtureApp() {
  const [ready, setReady] = useState(false)
  const [streamStatus, setStreamStatus] = useState('')
  useEffect(() => { void seed().then(() => setReady(true)) }, [])
  const stream = () => {
    new File(Paths.document, 'ui-stream-request.txt').write(String(activeChatSubscription()))
    const chat = chats.find((row) => row.id === activeChatSubscription())
    const response = chat?.responses?.at(-1)
    if (!response) return
    let sequence = 2
    const timer = setInterval(() => {
      const projected = usePrototypeStore.getState().chats.find((item) => item.id === chat!.id)?.messages
      if (projected?.some((message) => message.text.startsWith('Streaming token'))) setStreamStatus('Fixture projection streaming')
      const output = [{ type: 'message', content: [{ type: 'output_text', text: `Streaming token ${sequence}: ` + 'Hello from the fixture. '.repeat(sequence) }] }]
      useRealtimeStore.getState().receiveSnapshot({ ...response.snapshot, responseId: response.id, sequence, status: sequence < 200 ? 'in_progress' : 'completed', output, updatedAt: new Date().toISOString() })
      if (sequence++ >= 200) clearInterval(timer)
    }, 100)
  }
  if (!ready) return <Text>Seeding isolated fixture…</Text>
  return <AppProviders><App /><View style={{ position: 'absolute', top: 120, right: 12 }}><Pressable onPress={stream} accessibilityLabel="Fixture stream"><Text style={{ backgroundColor: '#ffe5a0', padding: 5, fontSize: 10 }}>Fixture stream</Text></Pressable><Text style={{ backgroundColor: '#ffe5a0', fontSize: 10 }}>{streamStatus}</Text></View></AppProviders>
}
registerRootComponent(FixtureApp)
