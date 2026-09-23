import { readFile, writeFile } from 'node:fs/promises'
const out = process.env.BENCH_OUTPUT ?? '/tmp/pulpo-longchat-benchmark'
const median = values => percentile(values, .5)
const percentile = (values, p) => { const a = values.filter(Number.isFinite).sort((a,b) => a-b); return a.length ? Math.round(a[Math.ceil(a.length*p)-1]*10)/10 : null }
const summary = { generatedAt: new Date().toISOString(), api: [], browser: [] }
try { summary.api = JSON.parse(await readFile(`${out}/api.json`, 'utf8')).map(c => ({ kind: c.kind, turns: c.turns, samples: c.runs.length, ...Object.fromEntries(['dbMs','dtoMs','branchMs','httpMs','ttfbMs','bytes','pagedMs','pagedBytes'].map(k => [k, median(c.runs.map(r => r[k]))])) })) } catch {}
for (const suffix of ['', '-slow', '-extreme', '-layout', '-rebase']) {
 let data
 try { data = JSON.parse(await readFile(`${out}/browser${suffix}.json`, 'utf8')) } catch { continue }
 summary.browserVersion = data.browser
 for (const c of data.results) {
  const phases = {}
  for (const phase of ['load','typing','scroll','stream','settle']) {
    const tasks = c.instrumentation?.longTasks.filter(t => t.phase === phase).map(t => t.ms) ?? []
    const frames = c.instrumentation?.frames.filter(t => t.phase === phase).map(t => t.ms) ?? []
    const events = c.instrumentation?.events.filter(t => t.phase === phase).map(t => t.ms) ?? []
    phases[phase] = { longTasks: tasks.length, blockingMs: Math.round(tasks.reduce((sum,ms) => sum + Math.max(0,ms-50),0)), longestTaskMs: percentile(tasks,1), frameP95Ms: percentile(frames,.95), frameMaxMs: percentile(frames,1), framesOver50ms: frames.filter(n => n>50).length, inputEventMaxMs: percentile(events,1) }
  }
  const seen = c.instrumentation?.streamSeen ?? []
  const byTick = new Map()
  for (const tick of seen) if (!byTick.has(tick.index)) byTick.set(tick.index,tick.latency)
  const writes = c.instrumentation?.writes.filter(w => w.key?.includes(':chat-data:')) ?? []
  const streamedResponses = writes.filter(w => w.phase === 'stream' && w.key.includes(':response:'))
  summary.browser.push({ variant: suffix || 'ordinary', kind: c.kind, turns: c.turns, repeat: c.repeat, cpu: c.cpu, openMs: c.openMs, cachedReloadMs: c.cachedReloadMs, cachedReloadFailed: c.cachedReloadFailed ?? false, domElements: c.loaded?.domElements, loadTaskMs: (c.metrics?.find(m => m.name === 'TaskDuration')?.value ?? 0)*1000, loadScriptMs: (c.metrics?.find(m => m.name === 'ScriptDuration')?.value ?? 0)*1000, loadLayoutMs: (c.metrics?.find(m => m.name === 'LayoutDuration')?.value ?? 0)*1000, bottomGap: c.loaded?.bottomGap, heapAfterGcMB: (c.metrics?.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0)/1048576, detailTransferBytes: c.loaded?.resources[0]?.encoded, detailDecodedBytes: c.loaded?.resources[0]?.decoded, draftCorrect: c.draftCorrect, concurrentDraftCorrect: c.concurrentDraftCorrect, cachedDraftCorrect: c.cachedDraftCorrect, streamIntegrity: c.streamIntegrity, readingAnchorShiftPx: c.readingAnchorShiftPx, streamTicksObserved: byTick.size, streamP50Ms: median([...byTick.values()]), streamP95Ms: percentile([...byTick.values()],.95), transcriptWrites: writes.length, streamResponseWrites: streamedResponses.length, streamUniqueResponseRecords: new Set(streamedResponses.map(w => w.key)).size, transcriptWriteSyncMaxMs: percentile(writes.map(w => w.ms),1), persistedBytes: c.storage?.persistedChats.reduce((a,c) => a+c.bytes,0), phases, errors: c.errors, failedRequests: c.failedRequests, failure: c.failure })
 }
}
await writeFile(`${out}/summary.json`, JSON.stringify(summary,null,2))
console.log(JSON.stringify(summary,null,2))
