// Standalone Release Hermes benchmark. Never imported by the normal app.
import React, { useEffect, useState } from 'react'
import { registerRootComponent } from 'expo'
import { Platform, ScrollView, Text } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { withBranchMetadata } from '../../src/mockup5/src/production/optimisticResponses'
import { baselineBranchMetadata, branchCases, branchFixture, sampleSummary } from './branch-metadata-fixture'

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

async function run(report: (status: string) => void) {
  const cases = []
  for (const scenario of branchCases) {
    report(`${scenario.shape}: ${scenario.count} responses`)
    const rows = branchFixture(scenario.count, scenario.shape)
    if (JSON.stringify(withBranchMetadata(rows)) !== JSON.stringify(baselineBranchMetadata(rows))) throw new Error('Metadata differs')
    for (let warmup = 0; warmup < 3; warmup++) { baselineBranchMetadata(rows); withBranchMetadata(rows); await pause() }
    const before: number[] = [], after: number[] = []
    for (let sample = 0; sample < 9; sample++) {
      for (const [work, samples] of sample % 2
        ? [[withBranchMetadata, after], [baselineBranchMetadata, before]] as const
        : [[baselineBranchMetadata, before], [withBranchMetadata, after]] as const) {
        await pause()
        const start = performance.now()
        const result = work(rows)
        samples.push(performance.now() - start)
        if (result.length !== rows.length) throw new Error('Incomplete metadata')
      }
    }
    cases.push({ ...scenario, before: sampleSummary(before), after: sampleSummary(after) })
  }
  return {
    timestamp: new Date().toISOString(), platform: Platform.OS, osVersion: Platform.Version,
    reactNative: Platform.constants.reactNativeVersion,
    hermes: Boolean((globalThis as unknown as { HermesInternal?: unknown }).HermesInternal), dev: __DEV__,
    baseline: '08b2b232', method: 'Production mobile functions versus frozen baseline in the same Release Hermes process; 3 warmups, 9 alternating samples, 30ms between samples. Synthetic JavaScript preparation, excludes React/native layout/network.', cases,
  }
}

export default function App() {
  const [status, setStatus] = useState('Starting branch metadata benchmark')
  useEffect(() => {
    void run(setStatus).then((result) => {
      const text = JSON.stringify(result, null, 2)
      new File(Paths.document, 'branch-metadata-results.json').write(text)
      if (Platform.OS === 'android') {
        const compact = JSON.stringify(result)
        for (let offset = 0; offset < compact.length; offset += 1500) {
          console.info(`PULPO_BRANCH_PERF_${offset}:` + compact.slice(offset, offset + 1500))
        }
      }
      setStatus(text)
    }).catch((error: unknown) => {
      const text = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
      new File(Paths.document, 'branch-metadata-error.txt').write(text)
      setStatus(text)
    })
  }, [])
  return <ScrollView contentContainerStyle={{ padding: 32 }}><Text selectable>{status}</Text></ScrollView>
}

registerRootComponent(App)
