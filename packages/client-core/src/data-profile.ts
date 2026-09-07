export interface ClientProfileScope { instance: string; userId: string; profileId: string }
let active: Readonly<ClientProfileScope> | undefined
let generation = 0
export const dataProfileScope = () => active
export const dataProfileGeneration = () => generation
export function configureDataProfile(scope: ClientProfileScope | undefined): void {
  active = scope && Object.freeze({ ...scope })
  generation += 1
}
export function dataProfileSuffix(userId?: string): string {
  return active && (!userId || userId === active.userId) && active.profileId !== active.userId ? `|profile:${active.profileId}` : ''
}
export const dataProfileHeaders = (): Record<string, string> => active ? { 'X-Pulpo-Profile-Id': active.profileId } : {}
export function dataProfileResourceUrl(url: string, origin: string): string {
  if (!active || !url || /^(?:blob:|data:|file:)/.test(url)) return url
  const target = new URL(url, origin)
  if (target.origin !== new URL(origin).origin) return url
  target.searchParams.set('profileId', active.profileId)
  return url.startsWith('/') ? `${target.pathname}${target.search}${target.hash}` : target.toString()
}
