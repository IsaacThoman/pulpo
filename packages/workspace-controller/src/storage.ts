import type { WorkspaceSpec } from './workspace-spec.js'

export const BOUNDED_DISK_BYTES = 20 * 1024 ** 3
export const BOUNDED_RUNTIME = 'kata-pulpo-bounded'

// Run before importing the daemon: readiness alone would permit commands to run
// on an accidentally misconfigured backend. Guest capacity includes filesystem
// overhead, so allow a small difference from the virtual block device size.
export const STORAGE_STARTUP_CHECK = `
import { statfsSync } from 'node:fs';
const expected = ${BOUNDED_DISK_BYTES};
for (const path of ['/', '/workspace', '/tmp', '/home/agent']) {
  const fs = statfsSync(path);
  const bytes = fs.bsize * fs.blocks;
  if (fs.type !== 0x794c7630 || bytes > expected || bytes < expected * 0.9) {
    throw new Error('Workspace storage boundary verification failed at ' + path);
  }
}
await import('/opt/pulpo-workspace-daemon/index.js');
`

export function storageSettings(runtime: string, spec: WorkspaceSpec) {
  if (runtime !== BOUNDED_RUNTIME) return { limit: spec.ephemeralStorage }
  if (spec.ephemeralStorage !== '20Gi') {
    throw new Error('This workspace runtime supports a fixed 20Gi writable disk')
  }
  return {
    // The snapshotter accounts for the preallocated 20Gi backing file. Leave
    // room for CRI logs so kubelet does not evict an empty preallocated disk.
    limit: '21Gi',
    command: ['node', '--input-type=module', '--eval', STORAGE_STARTUP_CHECK],
  }
}

export function workspacePodSlots(pods: { metadata?: { deletionTimestamp?: unknown }; status?: { phase?: string } }[]): number {
  // Terminating pods retain their slot. Completed pods no longer run, but their
  // disk still counts independently in the host snapshotter until actual cleanup.
  return pods.filter((pod) => pod.metadata?.deletionTimestamp || !['Succeeded', 'Failed'].includes(pod.status?.phase ?? '')).length
}
