import {
  ANIMATION_SPEED_MAX,
  ANIMATION_SPEED_MIN,
  DEFAULT_ANIMATION_SPEED,
} from '@pulpo/contracts'

export { ANIMATION_SPEED_MAX, ANIMATION_SPEED_MIN, DEFAULT_ANIMATION_SPEED }
export const DEFAULT_CHART_ANIMATION_DURATION_MS = 400

let currentSpeed = DEFAULT_ANIMATION_SPEED
let controllerStarted = false

export function normalizeAnimationSpeed(value: unknown): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= ANIMATION_SPEED_MIN
    && value <= ANIMATION_SPEED_MAX
    ? value
    : DEFAULT_ANIMATION_SPEED
}

export function clampAnimationSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ANIMATION_SPEED
  return Math.min(ANIMATION_SPEED_MAX, Math.max(ANIMATION_SPEED_MIN, value))
}

export function scaledAnimationDuration(durationMs: number, speed: unknown): number {
  return durationMs / normalizeAnimationSpeed(speed)
}

function updateAnimations(animations: Animation[]): void {
  for (const animation of animations) {
    if (animation.playbackRate === currentSpeed) continue
    try {
      animation.updatePlaybackRate(currentSpeed)
    } catch {
      animation.playbackRate = currentSpeed
    }
  }
}

function isElement(target: EventTarget | Node | null): target is Element {
  return typeof Element !== 'undefined' && target instanceof Element
}

function animationsFor(target: EventTarget | Node | null, subtree = false): Animation[] {
  if (!isElement(target) || typeof target.getAnimations !== 'function') return []
  return target.getAnimations({ subtree })
}

function updateAnimationsFromEvent(event: Event): void {
  updateAnimations(animationsFor(event.target))
}

export function applyAnimationSpeed(value: unknown): number {
  currentSpeed = normalizeAnimationSpeed(value)
  if (typeof document !== 'undefined' && typeof document.getAnimations === 'function') {
    updateAnimations(document.getAnimations())
  }
  return currentSpeed
}

export function startAnimationSpeedController(initialSpeed: unknown): void {
  applyAnimationSpeed(initialSpeed)
  if (controllerStarted
    || typeof document === 'undefined'
    || typeof document.addEventListener !== 'function') return
  controllerStarted = true

  document.addEventListener('animationstart', updateAnimationsFromEvent, true)
  document.addEventListener('transitionrun', updateAnimationsFromEvent, true)

  if (typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver((records) => {
    const targets = new Set<Element>()
    for (const record of records) {
      if (isElement(record.target)) targets.add(record.target)
      for (const node of record.addedNodes) {
        if (isElement(node)) targets.add(node)
      }
    }
    for (const target of targets) updateAnimations(animationsFor(target, true))
  })
  if (!document.documentElement) return
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'data-state',
      'data-side',
      'data-align',
      'data-visible',
      'data-collapsed',
      'data-animation-active',
      'data-desktop-temporary-chat',
    ],
    childList: true,
    subtree: true,
  })
}
