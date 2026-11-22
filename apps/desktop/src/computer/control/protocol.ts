/**
 * What the main process says to the native helper that sees and controls other apps. The protocol
 * is shared with the workspace daemon, which runs a Linux helper of its own in cloud workspaces, so
 * it lives beside the daemon (packages/workspace-daemon/src/control/protocol.ts).
 */
export * from '../../../../../packages/workspace-daemon/src/control/protocol'
