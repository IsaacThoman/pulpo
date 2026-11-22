/** Where the macOS helper is built: native/build/macos/pulpo-control. */
export const CONTROL_HELPER_PATH: string
/** Builds the macOS helper when a source is newer than it (always with `force`). Resolves to its path, or null on other systems. */
export function buildControlHelper(options?: { force?: boolean }): Promise<string | null>
