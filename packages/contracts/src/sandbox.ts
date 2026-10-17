/**
 * Policy for untrusted HTML previews. The `sandbox` directive gives the document an opaque origin, so it cannot
 * reach Pulpo cookies, storage, or authenticated requests. Served by deploy/nginx*.conf and the desktop renderer
 * protocol, and attached by the iOS preview's scheme handler. Keep in sync with SANDBOX_CSP in
 * apps/desktop/src/security.ts.
 */
export const SANDBOX_CSP = "sandbox allow-scripts allow-modals allow-popups allow-forms allow-downloads; default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'self' https:; worker-src blob:; frame-src 'none'; base-uri 'none'; form-action 'none'"
