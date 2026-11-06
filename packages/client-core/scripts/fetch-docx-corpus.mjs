#!/usr/bin/env node
/**
 * Download Apache POI Word OOXML test data (Apache-2.0); never execute its contents.
 * Requires Node 22, no dependencies. Usage: node fetch-docx-corpus.mjs [directory]
 * Corpus test:
 * PULPO_DOCX_CORPUS=<dir> npm run test -w @pulpo/client-core -- src/office/docx/corpus.test.ts
 */
import { mkdir, stat, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? '/tmp/pulpo-docx-corpus/poi');
const treeUrl = 'https://api.github.com/repos/apache/poi/git/trees/trunk?recursive=1';
const headers = { 'User-Agent': 'pulpo-docx-corpus', Accept: 'application/vnd.github+json' };

async function request(url) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return response;
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw failure;
}

async function main() {
  await mkdir(directory, { recursive: true });
  const tree = await (await request(treeUrl)).json();
  if (tree.truncated || !Array.isArray(tree.tree)) {
    throw new Error('GitHub returned an incomplete or invalid tree; refusing a partial corpus.');
  }
  const prefix = 'test-data/document/';
  const files = tree.tree.filter((entry) => entry.type === 'blob'
    && entry.path.startsWith(prefix) && /\.(docx|docm|dotx|dotm)$/i.test(entry.path));
  let cursor = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  async function worker() {
    while (cursor < files.length) {
      const entry = files[cursor++];
      const relative = entry.path.slice(prefix.length);
      const target = path.resolve(directory, relative);
      if (!target.startsWith(directory + path.sep)) throw new Error(`Unsafe path: ${entry.path}`);
      const temporary = `${target}.pulpo-download-${process.pid}`;
      try {
        try {
          const existing = await stat(target);
          if (!existing.isFile()) throw new Error(`Destination is not a file: ${target}`);
          skipped++;
          continue;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await mkdir(path.dirname(target), { recursive: true });
        const url = `https://raw.githubusercontent.com/apache/poi/trunk/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
        const data = new Uint8Array(await (await request(url)).arrayBuffer());
        if (typeof entry.size === 'number' && data.byteLength !== entry.size) {
          throw new Error(`Size mismatch (tree ${entry.size}, download ${data.byteLength})`);
        }
        await writeFile(temporary, data, { flag: 'wx' });
        await rename(temporary, target);
        downloaded++;
      } catch (error) {
        failed++;
        console.error(`${entry.path}: ${error.message}`);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Apache POI corpus: ${files.length} files; ${downloaded} downloaded, ${skipped} already present, ${failed} failed. Directory: ${directory}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
