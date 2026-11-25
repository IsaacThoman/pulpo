import { safeHttpUrl } from './navigation'

interface VideoEmbed {
  provider: 'YouTube' | 'Vimeo'
  playerUrl: string
  sourceUrl: string
}

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])
const youtubeEmbedHosts = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com'])
const youtubeVideoId = /^[a-z\d_-]{11}$/i
const vimeoHosts = new Set(['vimeo.com', 'www.vimeo.com'])
const vimeoHash = /^[a-f\d]{10,32}$/i

function youtubeEmbed(url: URL): VideoEmbed | undefined {
  let id: string | null | undefined
  if (url.hostname === 'youtu.be') {
    id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1]
  } else if (youtubeEmbedHosts.has(url.hostname)) {
    id = /^\/embed\/([^/]+)\/?$/.exec(url.pathname)?.[1]
  } else if (youtubeHosts.has(url.hostname)) {
    id = /^\/watch\/?$/.test(url.pathname)
      ? url.searchParams.get('v')
      : /^\/(?:embed|shorts|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1]
  }
  if (!id || !youtubeVideoId.test(id)) return
  return {
    provider: 'YouTube',
    playerUrl: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=0&playsinline=1',
    sourceUrl: 'https://www.youtube.com/watch?v=' + id,
  }
}

function vimeoEmbed(url: URL): VideoEmbed | undefined {
  const match = vimeoHosts.has(url.hostname)
    ? /^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?([1-9]\d{0,13})(?:\/([a-f\d]+))?\/?$/i.exec(url.pathname)
    : url.hostname === 'player.vimeo.com'
      ? /^\/video\/([1-9]\d{0,13})\/?$/.exec(url.pathname)
      : null
  if (!match) return
  const [, id, pathHash] = match
  const hash = pathHash ?? url.searchParams.get('h')
  if (hash !== null && !vimeoHash.test(hash)) return
  const player = new URL('https://player.vimeo.com/video/' + id)
  if (hash) player.searchParams.set('h', hash)
  player.searchParams.set('autoplay', '0')
  player.searchParams.set('dnt', '1')
  return {
    provider: 'Vimeo',
    playerUrl: player.href,
    sourceUrl: 'https://vimeo.com/' + id + (hash ? '/' + hash : ''),
  }
}

export function getVideoEmbed(value: string): VideoEmbed | undefined {
  const url = safeHttpUrl(value)
  if (!url || url.protocol !== 'https:' || url.port) return
  return youtubeEmbed(url) ?? vimeoEmbed(url)
}
