// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NotebookDiff } from './NotebookDiff'

afterEach(cleanup)

it('shows a metadata-only cell proposal as edited and names the changed settings', () => {
  const file = (hidden: boolean) => new TextEncoder().encode(JSON.stringify({
    nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{
      id: 'a', cell_type: 'markdown', source: 'unchanged source', metadata: { jupyter: { source_hidden: hidden } },
    }],
  }))
  const view = render(<NotebookDiff name="a.ipynb" before={file(false)} after={file(true)} />)
  expect(view.getByText('1 cell edited')).toBeTruthy()
  expect(view.getByText('Edited')).toBeTruthy()
  expect(view.getByText('Cell settings changed: jupyter')).toBeTruthy()
  expect(view.queryByText('The two versions are the same.')).toBeNull()
  expect(view.queryByText('Outputs changed')).toBeNull()
})
