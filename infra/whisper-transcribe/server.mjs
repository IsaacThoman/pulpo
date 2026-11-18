import { execFile } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const directory = fileURLToPath(new URL('.', import.meta.url));
const scratch = join(directory, 'uploads');
const port = Number(process.env.WHISPER_PORT || 5577);
const pulpoToken = process.env.WHISPER_PULPO_TOKEN;
if (pulpoToken && !/^[!-~]{32,}$/.test(pulpoToken)) {
  throw new Error('WHISPER_PULPO_TOKEN must contain at least 32 printable non-space characters');
}
const digest = (value) => createHash('sha256').update(value).digest();
const pulpoAuthorization = pulpoToken && digest(`Bearer ${pulpoToken}`);
const maxBytes = 512 * 1024 * 1024;
const sampleRate = 16000;
const maxPcmBytes = 2 * 60 * 60 * sampleRate * 4;
const jobs = new Map();
let busy = false;

// This directory is dedicated to the service. Remove any upload left by a restart.
await rm(scratch, { recursive: true, force: true });
await mkdir(scratch, { mode: 0o700 });

const files = new Map(await Promise.all([
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
].map(async ([path, filename, contentType]) => [
  path, [await readFile(join(directory, 'public', filename)), contentType],
])));

function json(response, code, data) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function transcribe(job, folder) {
  const input = join(folder, 'media');
  const pcm = join(folder, 'audio.pcm');
  const result = join(folder, 'result.json');
  const formats = 'aac,aiff,amr,asf,avi,caf,flac,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,mpeg,mpegts,ogg,wav,wv';
  try {
    try {
      await run(process.env.WHISPER_FFMPEG || 'ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-protocol_whitelist', 'file', '-format_whitelist', formats,
        '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(sampleRate),
        '-t', '7201', '-f', 'f32le', pcm,
      ], { timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' });
    } catch {
      job.error = 'This file could not be decoded. Try an audio or video file with a supported audio track.';
      return;
    }

    const { size } = await stat(pcm);
    if (size === 0 || size > maxPcmBytes) {
      job.error = size === 0 ? 'The file contains no audio.' : 'The audio exceeds the two-hour limit.';
      return;
    }

    job.stage = 'transcribing';
    await run(process.execPath, [join(directory, 'transcribe.mjs'), pcm, result], {
      timeout: 45 * 60 * 1000,
      killSignal: 'SIGKILL',
    });
    job.result = { ...JSON.parse(await readFile(result, 'utf8')), durationSeconds: size / (sampleRate * 4) };
  } catch (error) {
    console.error('Transcription failed', error.code ?? error.name, error.signal ?? '');
    job.error = 'Whisper could not finish this file. Try a different file or a shorter clip.';
  } finally {
    try {
      await rm(folder, { recursive: true, force: true });
    } catch {
      console.error('Could not remove temporary upload');
    }
    job.stage = job.error ? 'failed' : 'done';
    busy = false;
    setTimeout(() => jobs.delete(job.id), 15 * 60 * 1000).unref();
  }
}

async function acceptUpload(request, response, source) {
  const length = Number(request.headers['content-length']);
  if (request.headers['content-type'] !== 'application/octet-stream' ||
      (source === 'web' && request.headers['x-transcribe-upload'] !== '1')) {
    return json(response, 415, { error: 'Select a file to upload.' });
  }
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxBytes) {
    return json(response, 413, { error: 'Select a file between 1 byte and 512 MB.' });
  }
  if (busy) {
    return json(response, 503, { error: 'Another file is being processed. Try again in a moment.' });
  }

  busy = true;
  const id = randomUUID();
  const folder = join(scratch, id);
  try {
    await mkdir(folder, { mode: 0o700 });
    await pipeline(request, new Transform({
      transform(chunk, encoding, callback) {
        this.bytes = (this.bytes ?? 0) + chunk.length;
        callback(this.bytes > maxBytes ? new Error('Upload limit exceeded') : null, chunk);
      },
    }), createWriteStream(join(folder, 'media'), { flags: 'wx', mode: 0o600 }));
  } catch {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
    busy = false;
    if (!response.destroyed) json(response, 400, { error: 'The upload did not complete.' });
    return;
  }

  const job = { id, stage: 'decoding' };
  jobs.set(id, { source, job });
  json(response, 202, { id });
  void transcribe(job, folder);
}

const server = createServer({ requestTimeout: 30 * 60 * 1000 }, async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const path = (request.url ?? '/').split('?')[0];

  if (request.method === 'GET' && files.has(path)) {
    const [body, type] = files.get(path);
    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
    return;
  }
  const match = /^\/api\/(pulpo\/)?jobs(?:\/([0-9a-f-]+))?$/.exec(path);
  if (match) {
    const [, pulpo, id] = match;
    const source = pulpo ? 'pulpo' : 'web';
    if (pulpo) {
      if (!pulpoAuthorization) return json(response, 404, { error: 'The Pulpo API is disabled.' });
      if (!timingSafeEqual(digest(request.headers.authorization ?? ''), pulpoAuthorization)) {
        return json(response, 401, { error: 'Authentication required.' });
      }
    }
    if (request.method === 'POST' && !id) {
      await acceptUpload(request, response, source);
      return;
    }
    const entry = jobs.get(id);
    if (request.method === 'GET' && entry?.source === source) return json(response, 200, entry.job);
  }
  json(response, 404, { error: 'This page or transcription has expired or could not be found.' });
});

server.listen(port, '127.0.0.1');
