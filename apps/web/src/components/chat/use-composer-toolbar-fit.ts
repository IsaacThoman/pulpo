import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** How far the composer toolbar has collapsed: 0 labels everything, 1 shows the agent menu as an icon, 2 shows presets as icons too. */
export type ComposerToolbarFit = 0 | 1 | 2

// Sub-pixel layout rounding must not flip the toolbar back and forth.
const EPSILON = 0.5

/**
 * Collapses one step while labels truncate or the toolbar overflows, and
 * expands one step once the free space covers what that step saved.
 */
export function nextComposerToolbarFit(fit: ComposerToolbarFit, { overflow, slack, saved, maxFit }: {
  overflow: number
  slack: number
  saved: number | undefined
  maxFit: ComposerToolbarFit
}): ComposerToolbarFit {
  if (overflow > EPSILON && fit < maxFit) return (fit + 1) as ComposerToolbarFit
  if (fit > 0 && overflow <= EPSILON && saved !== undefined && slack >= saved + EPSILON) return (fit - 1) as ComposerToolbarFit
  return fit
}

/**
 * Fits the composer toolbar to its width: the agent menu drops its label
 * first, then presets drop theirs, rather than truncating them. `labels`
 * should change whenever a collapsible label does, so widths are remeasured.
 */
export function useComposerToolbarFit(labels: string, hasPresets: boolean) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<HTMLButtonElement>(null)
  const presetsRef = useRef<HTMLButtonElement>(null)
  const [fit, setFit] = useState<ComposerToolbarFit>(0)
  const fitRef = useRef(fit)
  // Labelled width of the control collapsed by each step, recorded as it collapses.
  const labelledWidths = useRef<number[]>([])
  const measuredLabels = useRef(labels)

  const update = useCallback(() => {
    const toolbar = toolbarRef.current
    const spacer = spacerRef.current
    if (!toolbar || !spacer) return
    const presets = presetsRef.current
    let labelOverflow = 0
    for (const label of presets?.querySelectorAll('[data-preset-label]') ?? []) {
      labelOverflow += Math.max(0, label.scrollWidth - label.clientWidth)
    }
    // Fractional boxes, since scrollWidth rounding can report a pixel of overflow that isn't there.
    const toolbarStyle = getComputedStyle(toolbar)
    const contentRight = toolbar.getBoundingClientRect().right - (Number.parseFloat(toolbarStyle.paddingRight) || 0)
    const childrenRight = Math.max(contentRight, ...Array.from(toolbar.children, (child) => child.getBoundingClientRect().right))
    const overflow = labelOverflow + childrenRight - contentRight
    // The spacer grows into free space; anything beyond its minimum is spare.
    const slack = spacer.getBoundingClientRect().width - (Number.parseFloat(getComputedStyle(spacer).minWidth) || 0)
    const controls = [agentRef.current, presets]
    const fit = fitRef.current
    const collapsed = fit > 0 ? controls[fit - 1] : null
    const recorded = fit > 0 ? labelledWidths.current[fit - 1] : undefined
    const saved = collapsed && recorded !== undefined ? recorded - collapsed.getBoundingClientRect().width : undefined
    const next = nextComposerToolbarFit(fit, { overflow, slack, saved, maxFit: hasPresets ? 2 : 1 })
    if (next === fit) return
    if (next > fit) {
      const collapsing = controls[fit]
      labelledWidths.current[fit] = (collapsing?.getBoundingClientRect().width ?? 0) + (collapsing === presets ? labelOverflow : 0)
    }
    fitRef.current = next
    setFit(next)
  }, [hasPresets])

  // Each step re-renders and remeasures before the browser paints.
  useLayoutEffect(() => {
    fitRef.current = fit
    if (measuredLabels.current !== labels) {
      measuredLabels.current = labels
      labelledWidths.current = []
      if (fit !== 0) {
        fitRef.current = 0
        setFit(0)
        return
      }
    }
    update()
  }, [fit, labels, update])

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    for (const element of [toolbarRef.current, spacerRef.current, presetsRef.current]) {
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [update])

  return { fit, toolbarRef, spacerRef, agentRef, presetsRef }
}
