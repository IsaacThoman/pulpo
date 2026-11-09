// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FilesPermissionItem } from '@pulpo/contracts'
import { useChat } from '@/stores/chat'
import { FilesPermissionPrompt, FilesPermissionStepRow } from './FilesPermissionPrompt'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})

const item = (fields: Partial<FilesPermissionItem> = {}): FilesPermissionItem => ({
  id: 'response-1:files-permission:1', type: 'pulpo_files_permission', status: 'awaiting_decision', command: 'cat', path: 'Taxes/2025.pdf',
  requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), ...fields,
})

const answer = vi.fn(async () => undefined)
beforeEach(() => { answer.mockClear(); useChat.setState({ answerFilesPermission: answer }) })
afterEach(cleanup)

it('asks for permission, naming what the agent asked about', async () => {
  render(<FilesPermissionPrompt responseId="response-1" item={item()} />)
  expect(screen.getByRole('heading', { name: 'Pulpo Agent wants to look through your Files' })).toBeTruthy()
  expect(screen.getByText(/It asked about “Taxes\/2025\.pdf”\./)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Allow for this chat' }))
  expect(answer).toHaveBeenCalledExactlyOnceWith('response-1', 'response-1:files-permission:1', 'allow_chat')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true))
})

it('offers always allowing and denying', async () => {
  render(<FilesPermissionPrompt responseId="response-1" item={item({ path: '', command: 'ls' })} />)
  expect(screen.getByText(/It asked to list My files\./)).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('button', { name: 'More ways to allow' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /Always allow reading Files/ }))
  expect(answer).toHaveBeenCalledWith('response-1', 'response-1:files-permission:1', 'allow_always')
})

it('lets the user try again when the answer could not be sent', async () => {
  answer.mockRejectedValueOnce(new Error('This reply is no longer waiting for your answer'))
  render(<FilesPermissionPrompt responseId="response-1" item={item()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This reply is no longer waiting for your answer')
  expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(false)
})

it('labels each outcome in the activity', () => {
  const { rerender } = render(<FilesPermissionStepRow item={item()} live />)
  expect(screen.getByText('Waiting for permission to look through your Files')).toBeTruthy()
  rerender(<FilesPermissionStepRow item={item({ expires_at: new Date(Date.now() - 1).toISOString() })} live />)
  expect(screen.getByText("Didn't get an answer about your Files")).toBeTruthy()
  rerender(<FilesPermissionStepRow item={item({ status: 'allowed' })} live={false} />)
  expect(screen.getByText('Allowed to look through your Files in this chat')).toBeTruthy()
  rerender(<FilesPermissionStepRow item={item({ status: 'denied' })} live={false} />)
  expect(screen.getByText('Not allowed to look through your Files')).toBeTruthy()
})
