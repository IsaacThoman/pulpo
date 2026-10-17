import { expect, it, vi } from 'vitest'
import { registerAccountCleanup, runAccountCleanups } from './accountCleanup'

it('runs every registered cleanup for the namespace, even when one fails', async () => {
  const first = vi.fn(async () => { throw new Error('offline') })
  const second = vi.fn()
  const unregister = registerAccountCleanup(first)
  registerAccountCleanup(second)
  await runAccountCleanups('instance|user')
  expect(first).toHaveBeenCalledWith('instance|user')
  expect(second).toHaveBeenCalledWith('instance|user')
  unregister()
  await runAccountCleanups('instance|other')
  expect(first).toHaveBeenCalledTimes(1)
})
