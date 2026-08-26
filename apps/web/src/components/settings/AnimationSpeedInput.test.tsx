// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnimationSpeedInput } from './AnimationSpeedInput'

function Harness() {
  const [value, setValue] = useState(1)
  return <AnimationSpeedInput value={value} onChange={setValue} />
}

afterEach(cleanup)

describe('AnimationSpeedInput', () => {
  it('allows incomplete decimals and clamps them when committed', () => {
    const view = render(<Harness />)
    const input = view.getByLabelText('Animation speed multiplier') as HTMLInputElement

    fireEvent.change(input, { target: { value: '0' } })
    expect(input.value).toBe('0')
    fireEvent.change(input, { target: { value: '0.125' } })
    expect(input.value).toBe('0.125')

    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.blur(input)
    expect(input.value).toBe('5')
  })

  it('restores normal speed with Reset', () => {
    const view = render(<Harness />)
    const input = view.getByLabelText('Animation speed multiplier') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2.5' } })
    fireEvent.click(view.getByRole('button', { name: 'Reset' }))
    expect(input.value).toBe('1')
  })
})
