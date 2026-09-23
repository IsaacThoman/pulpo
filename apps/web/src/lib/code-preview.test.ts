import { describe, expect, it } from 'vitest'
import {
  isSandboxInboundMessage,
  isSandboxOutboundMessage,
  previewFileName,
  previewKindForFile,
  previewKindForLanguage,
  previewTitle,
} from './code-preview'

describe('previewKindForLanguage', () => {
  it.each([
    ['html', 'html'],
    ['HTML', 'html'],
    ['htm', 'html'],
    ['svg', 'svg'],
    ['jsx', 'jsx'],
    ['tsx', 'jsx'],
    ['react', 'jsx'],
    ['ts', null],
    ['python', null],
    ['', null],
  ] as const)('maps %s to %s', (language, expected) => {
    expect(previewKindForLanguage(language)).toBe(expected)
  })

  it('treats XML that is an SVG drawing as SVG', () => {
    expect(previewKindForLanguage('xml', '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('svg')
    expect(previewKindForLanguage('xml', '<feed></feed>')).toBeNull()
  })
})

describe('previewKindForFile', () => {
  it.each([
    ['index.html', '', 'html'],
    ['page.HTM', '', 'html'],
    ['App.jsx', '', 'jsx'],
    ['Widget.tsx', '', 'jsx'],
    ['logo.svg', '', 'svg'],
    ['export', 'text/html', 'html'],
    ['notes.txt', 'text/plain', null],
  ] as const)('maps %s (%s) to %s', (name, mimeType, expected) => {
    expect(previewKindForFile(name, mimeType)).toBe(expected)
  })
})

describe('previewTitle', () => {
  it('uses the page title, the default-exported component, or the kind', () => {
    expect(previewTitle('html', '<html><head><title> Solar system </title></head></html>')).toBe('Solar system')
    expect(previewTitle('jsx', 'export default function Mains() {}')).toBe('Mains')
    expect(previewTitle('jsx', 'const Dashboard = () => null\nexport default Dashboard')).toBe('Dashboard')
    expect(previewTitle('jsx', 'export default () => null')).toBe('JSX')
    expect(previewTitle('svg', '<svg/>')).toBe('SVG')
  })
})

describe('previewFileName', () => {
  it('builds a safe file name with the right extension', () => {
    expect(previewFileName('Solar system', 'html')).toBe('Solar-system.html')
    expect(previewFileName('Mains', 'jsx')).toBe('Mains.jsx')
    expect(previewFileName('logo.svg', 'svg')).toBe('logo.svg')
    expect(previewFileName('///', 'svg')).toBe('preview.svg')
  })
})

describe('sandbox message guards', () => {
  it('accepts only well-formed messages', () => {
    expect(isSandboxInboundMessage({ type: 'pulpo-sandbox:render', kind: 'jsx', code: 'x' })).toBe(true)
    expect(isSandboxInboundMessage({ type: 'pulpo-sandbox:render', kind: 'js', code: 'x' })).toBe(false)
    expect(isSandboxInboundMessage({ type: 'pulpo-sandbox:render', kind: 'html' })).toBe(false)
    expect(isSandboxOutboundMessage({ type: 'pulpo-sandbox:ready' })).toBe(true)
    expect(isSandboxOutboundMessage({ type: 'pulpo-sandbox:error', message: 'boom' })).toBe(true)
    expect(isSandboxOutboundMessage({ type: 'pulpo-sandbox:error', message: {} })).toBe(false)
    expect(isSandboxOutboundMessage('pulpo-sandbox:ready')).toBe(false)
    expect(isSandboxOutboundMessage({ type: 'pulpo-sandbox:missing-styles', files: ['./styles.css'] })).toBe(true)
    expect(isSandboxOutboundMessage({ type: 'pulpo-sandbox:missing-styles', files: [1] })).toBe(false)
  })
})
