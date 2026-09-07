// Standalone simulator benchmark entry. Never imported by the application.
import React, { useEffect, useState } from 'react'
import { registerRootComponent } from 'expo'
import { Platform, ScrollView, Text } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { QueryClient } from '@tanstack/react-query'
import { startTranscriptResidency } from '../../src/providers/transcriptResidency'
import { usePrototypeStore } from '../../src/mockup5/src/store/prototypeStore'
import type { PrototypeChat } from '../../src/mockup5/src/domain'
import { hydrateEmbeddedResponseSnapshot } from '@pulpo/client-core'
import { createChatProjector } from '../../src/features/chat/projection'
import { useRealtimeStore } from '../../src/providers/realtimeStore'
import { cachedChat, getValue, markCachedChatOpened, mobileDatabase } from '../../src/data/database'
import { withoutCachedChatDetails } from '../../src/data/cache'
import { fixture } from './fixture'

const namespace = 'performance-audit-synthetic'
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30))
const round = (value: number) => Math.round(value * 100) / 100


async function measure(work: () => unknown | Promise<unknown>, repetitions = 15) {
  for (let index = 0; index < 3; index++) await work()
  const samplesMs: number[] = []
  for (let index = 0; index < repetitions; index++) {
    await pause()
    const started = performance.now()
    await work()
    samplesMs.push(performance.now() - started)
  }
  const sorted = [...samplesMs].sort((a, b) => a - b)
  return { medianMs: round(sorted[Math.floor(sorted.length / 2)]!), p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]!), samplesMs: samplesMs.map(round) }
}

async function run(report: (text: string) => void) {
  const result: Record<string, unknown> = {
    date: new Date().toISOString(), platform: Platform.OS, osVersion: Platform.Version,
    reactNative: Platform.constants.reactNativeVersion,
    hermes: Boolean((globalThis as unknown as { HermesInternal?: unknown }).HermesInternal),
    dev: __DEV__, sourceCommit: '675eb022 + fix-mobile-performance working tree',
    method: 'Current functions in a freshly built Release native app; synthetic function and residency benchmarks.',
  }
  const projection: unknown[] = []
  for (const turns of [10, 100, 250, 500, 1000]) {
    report(`Projecting ${turns} turns…`)
    const chat = fixture(turns)
    const project = createChatProjector()
    let sequence = 2
    const last = chat.responses!.at(-1)!
    projection.push({ turns, ...await measure(() => {
      const messages = project(chat, { [last.id]: { ...hydrateEmbeddedResponseSnapshot(last.snapshot, last.output), sequence: sequence++, status: 'in_progress' } })
      if (messages.length !== turns * 2) throw new Error('Fixture lineage is incomplete')
    }) })
  }
  result.projection = projection

  const hydration: unknown[] = []
  for (const turns of [100, 500, 1000]) {
    report(`Hydrating ${turns} snapshots…`)
    const snapshots = fixture(turns).responses!.map((response) => hydrateEmbeddedResponseSnapshot(response.snapshot, response.output))
    let notifications = 0
    const unsubscribe = useRealtimeStore.subscribe(() => { notifications++ })
    const timing = await measure(() => {
      useRealtimeStore.getState().resetSnapshots()
      notifications = 0
      useRealtimeStore.getState().receiveSnapshots(snapshots)
    })
    hydration.push({ turns, notifications, ...timing })
    unsubscribe()
  }
  result.snapshotHydration = hydration
  useRealtimeStore.getState().resetSnapshots()
  const client = new QueryClient()
  usePrototypeStore.setState({ productionNamespace: namespace, chats: [] })
  const residency = startTranscriptResidency(client, namespace)
  residency.activate('visited-19')
  const residencyCounts: number[] = []
  const runtimeMemoryAfterCycles: unknown[] = []
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let index = 0; index < 20; index++) {
      const chat = fixture(100, 256, `visited-${index}`)
      useRealtimeStore.getState().receiveSnapshots(chat.responses!.map((response) => hydrateEmbeddedResponseSnapshot(response.snapshot, response.output)))
      usePrototypeStore.setState((state) => ({ chats: [...state.chats.filter((row) => row.id !== chat.id), { id: chat.id, messages: [], detailLoaded: true } as unknown as PrototypeChat] }))
      client.setQueryData(['chat', namespace, chat.id], chat)
      await pause()
    }
    for (let attempt = 0; attempt < 40 && client.getQueryCache().findAll().length > 6; attempt++) await pause()
    residencyCounts.push(client.getQueryCache().findAll().length)
    const hermes = (globalThis as unknown as { HermesInternal?: { getInstrumentedStats?: () => unknown } }).HermesInternal
    runtimeMemoryAfterCycles.push(hermes?.getInstrumentedStats?.() ?? 'Heap instrumentation unavailable in this Release runtime')
  }
  result.residencyCountsAfter20ChatCycles = residencyCounts
  result.runtimeMemoryAfterCycles = runtimeMemoryAfterCycles
  result.retainedSnapshotsAfter20Chats = Object.keys(useRealtimeStore.getState().snapshots).length
  residency.dispose(); client.clear()
  useRealtimeStore.getState().resetSnapshots()

  const database = await mobileDatabase()
  const cache: unknown[] = []
  for (const count of [1, 10, 45]) {
    report(`Reading cache with ${count} documents…`)
    await database.runAsync('DELETE FROM chat_cache WHERE namespace = ?', namespace)
    await database.runAsync('DELETE FROM chat_access WHERE namespace = ?', namespace)
    let bytes = 0
    await database.withTransactionAsync(async () => {
      for (let index = 0; index < count; index++) {
        const chat = fixture(100, 2048, `cached-${index}`)
        const payload = JSON.stringify(chat)
        bytes += payload.length // Fixtures contain ASCII only.
        await database.runAsync('INSERT INTO chat_cache(namespace, chat_id, payload, updated_at) VALUES (?, ?, ?, ?)', namespace, chat.id, JSON.stringify(withoutCachedChatDetails(chat)), index)
        await database.runAsync('INSERT INTO chat_details(namespace, chat_id, payload, payload_bytes) VALUES (?, ?, ?, length(CAST(? AS BLOB)))', namespace, chat.id, payload, payload)
      }
    })
    const metadata = await measure(() => database.getAllAsync('SELECT payload_bytes FROM chat_details WHERE namespace = ?', namespace), 5)
    const targeted = await measure(async () => {
      const chat = await cachedChat(namespace, 'cached-0')
      if (!chat?.responses) throw new Error('Missing fixture')
    }, 10)
    const trim = await measure(() => markCachedChatOpened(namespace, 'cached-0', 50), 10)
    const queueStarted = performance.now()
    const maintenance = markCachedChatOpened(namespace, 'cached-0', 50)
    await getValue(namespace, 'nonexistent')
    const queuedReadMs = round(performance.now() - queueStarted)
    await maintenance
    cache.push({ count, payloadBytes: bytes, metadataRead: metadata, targetedRead: targeted, markOpenedAndTrim: trim, tinyReadBehindTrimMs: queuedReadMs })
  }
  result.cache = cache
  await database.runAsync('DELETE FROM chat_cache WHERE namespace = ?', namespace)
  await database.runAsync('DELETE FROM chat_access WHERE namespace = ?', namespace)
  const output = new File(Paths.document, 'performance-after.json')
  const json = JSON.stringify(result, null, 2)
  output.write(json)
  if (Platform.OS === 'android') {
    // Release APKs disallow run-as; retrieve synthetic results from logcat.
    const compact = JSON.stringify(result)
    for (let i = 0; i < compact.length; i += 1500) console.info(`PULPO_PERF_${i}:` + compact.slice(i, i + 1500))
  }
  report(`Complete\n\n${JSON.stringify(result, null, 2)}`)
}

export default function Audit() {
  const [status, setStatus] = useState('Starting isolated performance audit…')
  useEffect(() => { void run(setStatus).catch((error) => {
    const text = String(error?.stack ?? error)
    new File(Paths.document, 'performance-audit-error.txt').write(text)
    setStatus(text)
  }) }, [])
  return <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 70 }}><Text selectable>{status}</Text></ScrollView>
}

registerRootComponent(Audit)
