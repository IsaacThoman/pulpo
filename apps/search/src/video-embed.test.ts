import { describe, expect, it } from 'vitest'
import { getVideoEmbed } from './video-embed'

describe('video embed addresses', () => {
  it.each([
    'https://www.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1&next=https://example.com',
    'https://youtu.be/M7lc1UVf-VE?si=tracking',
    'https://m.youtube.com/shorts/M7lc1UVf-VE',
    'https://www.youtube.com/live/M7lc1UVf-VE',
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
  ])('normalizes YouTube video %s', url => {
    expect(getVideoEmbed(url)).toEqual({
      provider: 'YouTube',
      playerUrl: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=0&playsinline=1',
      sourceUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    })
  })

  it('uses Vimeo’s player with tracking reduced and preserves an unlisted video hash', () => {
    expect(getVideoEmbed('https://vimeo.com/channels/staffpicks/76979871?autoplay=1')).toEqual({
      provider: 'Vimeo',
      playerUrl: 'https://player.vimeo.com/video/76979871?autoplay=0&dnt=1',
      sourceUrl: 'https://vimeo.com/76979871',
    })
    expect(getVideoEmbed('https://vimeo.com/76979871/12345abcde?background=1')).toEqual({
      provider: 'Vimeo',
      playerUrl: 'https://player.vimeo.com/video/76979871?h=12345abcde&autoplay=0&dnt=1',
      sourceUrl: 'https://vimeo.com/76979871/12345abcde',
    })
    expect(getVideoEmbed('https://player.vimeo.com/video/76979871?h=12345abcde')?.sourceUrl)
      .toBe('https://vimeo.com/76979871/12345abcde')
  })

  it.each([
    'http://www.youtube.com/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com:444/watch?v=M7lc1UVf-VE',
    'https://name:password@www.youtube.com/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com.example.org/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com@bad.example.org/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com/embed/M7lc1UVf-VE/other-path',
    'https://www.youtube.com/playlist?v=M7lc1UVf-VE&list=test',
    'https://www.youtube.com/watch?v=M7lc1UVf-V%2F',
    'https://vimeo.com/76979871?h=unsafe.example',
    'https://vimeo.com/not-a-video/76979871',
    'https://player.vimeo.com.example.org/video/76979871',
    'javascript:alert(1)',
  ])('rejects unsupported or unsafe result %s', url => {
    expect(getVideoEmbed(url)).toBeUndefined()
  })
})
