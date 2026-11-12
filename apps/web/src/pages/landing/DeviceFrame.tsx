import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type DeviceShot = {
  platform: 'ios' | 'android'
  /** Describes the screen for image search; the section labels the group for screen readers. */
  alt: string
  /** Screenshot paths under public/, one per page theme. */
  light: string
  dark: string
  width: number
  height: number
}

// Screenshots hold only what the app and status bar draw, so the frame adds the hardware on top: the
// display's corners, the iPhone's Dynamic Island and home indicator, and the Android camera hole.
//
// iPhone 17/18 Pro (1206×2622 px, 402×874 pt): the screen shape is the simulator's framebuffer mask
// (CoreSimulator iPhone 18 Pro.simdevicetype, 62 pt continuous corners). The island is 126×37 pt, 11 pt
// from the top; the home indicator is 139×5 pt, 8 pt from the bottom.
const IOS_SCREEN_PATH = 'M952 0C968 0 984.1 0 1000.1.6 1018.5 1.3 1036.6 2.7 1054.7 6.1 1091.3 12.9 1124.6 27.7 1151.4 54.6 1178.3 81.4 1193.1 114.7 1199.9 151.3 1203.3 169.4 1204.7 187.5 1205.4 205.9 1205.9 221.8 1206 237.6 1206 253.5L1206 2368.5C1206 2384.4 1205.9 2400.2 1205.4 2416.1 1204.7 2434.5 1203.3 2452.6 1199.9 2470.7 1193.1 2507.3 1178.3 2540.6 1151.4 2567.4 1124.6 2594.3 1091.3 2609.1 1054.7 2615.9 1036.6 2619.3 1018.5 2620.7 1000.1 2621.4 984.1 2622 968 2622 952 2622L254 2622C238 2622 221.9 2622 205.9 2621.4 187.5 2620.7 169.4 2619.3 151.3 2615.9 114.7 2609.1 81.4 2594.3 54.6 2567.4 27.7 2540.6 12.9 2507.3 6.1 2470.7 2.7 2452.6 1.3 2434.5.6 2416.1.1 2400.2 0 2384.4 0 2368.5L0 253.5C0 237.6.1 221.8.6 205.9 1.3 187.5 2.7 169.4 6.1 151.3 12.9 114.7 27.7 81.4 54.6 54.6 81.4 27.7 114.7 12.9 151.3 6.1 169.4 2.7 187.5 1.3 205.9.6 221.9 0 238 0 254 0Z'
const IOS_SCREEN_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1206 2622" preserveAspectRatio="none"><path d="${IOS_SCREEN_PATH}"/></svg>`)}")`
const IOS_SCREEN_STYLE: CSSProperties = { maskImage: IOS_SCREEN_MASK, WebkitMaskImage: IOS_SCREEN_MASK, maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }

// Android: the emulator's Pixel 8 display overlay (1080×2400 px): 104 px top and 102 px bottom corner
// radii, and a 72.5 px camera hole centered 65.75 px from the top.
const ANDROID_SCREEN = 'rounded-[9.63%_9.63%_9.44%_9.44%/4.33%_4.33%_4.25%_4.25%]'

const BUTTON = 'absolute w-[1.4%] bg-neutral-500 dark:bg-neutral-600'

/** A phone showing a real app screenshot that follows the page's light or dark theme. */
export function DeviceFrame({ shot }: { shot: DeviceShot }) {
  const ios = shot.platform === 'ios'
  return (
    <div className="landing-device relative">
      {ios ? (
        <>
          {/* Action, volume, and side buttons. */}
          <span className={cn(BUTTON, 'top-[17.5%] -left-[0.7%] h-[3.6%] rounded-l-sm')} />
          <span className={cn(BUTTON, 'top-[24.5%] -left-[0.7%] h-[6.6%] rounded-l-sm')} />
          <span className={cn(BUTTON, 'top-[32.5%] -left-[0.7%] h-[6.6%] rounded-l-sm')} />
          <span className={cn(BUTTON, 'top-[28%] -right-[0.7%] h-[10.5%] rounded-r-sm')} />
        </>
      ) : (
        <>
          {/* Power and volume keys. */}
          <span className={cn(BUTTON, 'top-[19%] -right-[0.7%] h-[6%] rounded-r-sm')} />
          <span className={cn(BUTTON, 'top-[29%] -right-[0.7%] h-[11%] rounded-r-sm')} />
        </>
      )}
      {/* The bezel radii are the screen's corner radius plus each layer's padding, so the corners stay concentric. */}
      <div className={cn(
        'shadow-2xl shadow-black/30 dark:shadow-black/70',
        ios
          ? 'rounded-[17.7cqw] bg-linear-to-b from-neutral-400 via-neutral-600 to-neutral-500 p-[0.95cqw] dark:from-neutral-500 dark:via-neutral-700 dark:to-neutral-600'
          : 'rounded-[11.9cqw] bg-neutral-600 p-[0.8cqw] dark:bg-neutral-700',
      )}>
        <div className={cn('bg-black', ios ? 'rounded-[16.75cqw] p-[2.35cqw]' : 'rounded-[11.1cqw] p-[2cqw]')}>
          <div className={cn('relative overflow-hidden bg-black', !ios && ANDROID_SCREEN)} style={ios ? IOS_SCREEN_STYLE : undefined}>
            <img src={shot.light} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" decoding="async" className="block h-auto w-full dark:hidden" />
            <img src={shot.dark} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" decoding="async" className="hidden h-auto w-full dark:block" />
            {ios ? (
              <>
                <span className="absolute top-[1.259%] left-[34.33%] h-[4.233%] w-[31.34%] rounded-full bg-black" />
                {/* Dark on light screens and light on dark ones, like the system draws it. */}
                <span className="absolute bottom-[0.915%] left-[32.71%] h-[0.572%] w-[34.58%] rounded-full bg-black dark:bg-white" />
              </>
            ) : (
              <span className="absolute top-[1.229%] left-[46.62%] h-[3.021%] w-[6.713%] rounded-full bg-black" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
