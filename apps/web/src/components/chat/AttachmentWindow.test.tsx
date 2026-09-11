// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AttachmentWindow } from './AttachmentWindow'

afterEach(cleanup)
it('mounts at most 20 of 500 attachments and makes every file reachable', () => {
  const files = Array.from({ length: 500 }, (_, index) => `File ${index + 1}`)
  render(<AttachmentWindow items={files}>{(items) => <>{items.map((name) => <div data-testid="attachment" key={name}>{name}</div>)}</>}</AttachmentWindow>)
  expect(screen.getAllByTestId('attachment')).toHaveLength(20)
  expect(screen.queryByText('File 21')).toBeNull()
  for (let page = 1; page < 25; page++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByTestId('attachment')).toHaveLength(20)
  }
  expect(screen.getByText('File 500')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.getByText('File 480')).toBeTruthy()
})
