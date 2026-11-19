import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { folderPathSegments, resolveInFolder } from './paths'

describe('folderPathSegments', () => {
  it('accepts plain relative paths and normalizes empty and dot segments', () => {
    expect(folderPathSegments('', 'darwin')).toEqual([])
    expect(folderPathSegments('.', 'darwin')).toEqual([])
    expect(folderPathSegments('src/a.ts', 'darwin')).toEqual(['src', 'a.ts'])
    expect(folderPathSegments('./src//a.ts/', 'darwin')).toEqual(['src', 'a.ts'])
    expect(folderPathSegments('..hidden/file..txt', 'darwin')).toEqual(['..hidden', 'file..txt'])
  })

  it.each([
    '/etc/passwd', '..', '../x', 'a/../../x', 'a/..', 'a\0b', '~/x', '~', 'a\\..\\..\\x', '\\\\server\\share', 'C:/Windows', 'c:x',
  ])('refuses %j everywhere', (value) => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) expect(() => folderPathSegments(value, platform), platform).toThrow(/not inside the folder/)
  })

  it.each([
    'CON', 'con.txt', 'a/NUL', 'aux.tar.gz', 'COM1', 'lpt9.log', 'COM¹', 'CONIN$', 'a/b:stream', 'file::$DATA', '.. ', '..\t', 'a.', 'name ', 'a/b?.txt', 'a<b', 'a|b', 'a"b', 'a*b', 'x\u0001',
  ])('refuses %j on Windows', (value) => {
    expect(() => folderPathSegments(value, 'win32')).toThrow(/not inside the folder/)
  })

  it('keeps names Windows forbids usable on macOS', () => {
    expect(folderPathSegments('CON/a:b/name.', 'darwin')).toEqual(['CON', 'a:b', 'name.'])
  })
})

describe('resolveInFolder', () => {
  let base: string
  let root: string
  let outside: string

  beforeEach(async () => {
    base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pulpo-paths-')))
    root = path.join(base, 'root')
    outside = path.join(base, 'outside')
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(root, 'src', 'a.txt'), 'a')
    await writeFile(path.join(outside, 'secret.txt'), 'secret')
  })

  afterEach(async () => { await rm(base, { recursive: true, force: true }) })

  it('resolves existing and new paths inside the folder', async () => {
    await expect(resolveInFolder(root, 'src/a.txt')).resolves.toEqual({ absolute: path.join(root, 'src', 'a.txt'), relative: 'src/a.txt', exists: true })
    await expect(resolveInFolder(root, 'src/new/deeper.txt')).resolves.toEqual({ absolute: path.join(root, 'src', 'new', 'deeper.txt'), relative: 'src/new/deeper.txt', exists: false })
    await expect(resolveInFolder(root, '')).resolves.toMatchObject({ absolute: root, relative: '', exists: true })
  })

  it('refuses symlinks that lead out, to files, folders or nowhere', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'file-link'))
    await symlink(outside, path.join(root, 'dir-link'))
    await symlink(path.join(outside, 'missing.txt'), path.join(root, 'dangling'))
    await symlink(path.join(root, 'loop-b'), path.join(root, 'loop-a'))
    await symlink(path.join(root, 'loop-a'), path.join(root, 'loop-b'))
    for (const requested of ['file-link', 'dir-link', 'dir-link/secret.txt', 'dir-link/new.txt', 'dangling', 'loop-a', 'loop-a/x']) {
      await expect(resolveInFolder(root, requested), requested).rejects.toMatchObject({ code: 'outside_folder' })
    }
  })

  it('allows symlinks that stay inside the folder', async () => {
    await symlink(path.join(root, 'src'), path.join(root, 'src-link'))
    await expect(resolveInFolder(root, 'src-link/a.txt')).resolves.toMatchObject({ absolute: path.join(root, 'src', 'a.txt'), relative: 'src-link/a.txt' })
  })

  it('refuses a root-level symlink to a sibling whose name shares the prefix', async () => {
    await mkdir(`${root}-evil`)
    await symlink(`${root}-evil`, path.join(root, 'sibling'))
    await expect(resolveInFolder(root, 'sibling/x')).rejects.toMatchObject({ code: 'outside_folder' })
  })

  it('reports a path through a file as not found', async () => {
    await expect(resolveInFolder(root, 'src/a.txt/child')).rejects.toMatchObject({ code: 'not_found' })
  })
})
