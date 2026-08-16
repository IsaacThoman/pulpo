import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InstructionPreset } from '@pulpo/contracts'
import { InstructionPresetButtons } from './InstructionPresetButtons'
import { instructionPresetEnabled } from './instruction-preset-buttons-logic'

const preset: InstructionPreset = {
  id: 'casual',
  title: 'Casual',
  instructions: 'Be casual.',
  color: '#8b5cf6',
  defaultEnabled: true,
}

describe('instruction preset buttons', () => {
  it('inherits the admin default until the user makes an explicit choice', () => {
    expect(instructionPresetEnabled(preset, {})).toBe(true)
    expect(instructionPresetEnabled(preset, { casual: false })).toBe(false)
  })

  it('renders an accessible pressed state with the configured color', () => {
    const markup = renderToStaticMarkup(
      <InstructionPresetButtons presets={[preset]} selections={{}} onToggle={() => undefined} />,
    )
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('background-color:#8b5cf6')
    expect(markup).toContain('Casual')
  })

  it('renders an explicit opt-out as unpressed', () => {
    const markup = renderToStaticMarkup(
      <InstructionPresetButtons presets={[preset]} selections={{ casual: false }} onToggle={() => undefined} />,
    )
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('background-color:var(--muted)')
    expect(markup).toContain('border-color:var(--border)')
    expect(markup).toContain('color:var(--muted-foreground)')
  })
})
