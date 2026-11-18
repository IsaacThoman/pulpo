const get = (id) => document.getElementById(id);
const form = get('upload-form');
const media = get('media');
const dropzone = get('dropzone');
const submit = get('submit');
const status = get('status');
const progress = get('progress');
const result = get('result');
const plain = get('plain');
const timed = get('timed');
const copy = get('copy');
const maxBytes = 512 * 1024 * 1024;

let file;
let transcript;
let pending = false;
let copyReset;

function setStatus(text, error = false) {
  if (status.textContent !== text) status.textContent = text;
  status.classList.toggle('error', error);
}

function selectFile(selected) {
  file = null;
  submit.disabled = true;
  get('file-heading').textContent = selected?.name || 'Choose a file or drop it here';
  get('file-detail').textContent = selected
    ? formatSize(selected.size)
    : 'Audio or video · Up to 512 MB and 2 hours';
  setStatus('');
  if (!selected) return;
  if (selected.size === 0 || selected.size > maxBytes) {
    setStatus(selected.size === 0 ? 'This file is empty.' : 'This file is larger than 512 MB.', true);
    return;
  }
  file = selected;
  submit.disabled = false;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

media.addEventListener('change', () => {
  const selected = media.files[0];
  if (selected) selectFile(selected);
  media.value = '';
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!pending) dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', (event) => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging');
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
  if (!pending && event.dataTransfer.files.length > 0) selectFile(event.dataTransfer.files[0]);
});

function upload(selected) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/jobs');
    request.responseType = 'json';
    request.timeout = 30 * 60 * 1000;
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-Transcribe-Upload', '1');

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      progress.value = event.loaded / event.total * 100;
    };
    request.upload.onload = () => {
      progress.removeAttribute('value');
      setStatus('Preparing audio…');
    };
    request.onload = () => {
      if (request.status === 202 && request.response?.id) resolve(request.response.id);
      else reject(new Error(request.response?.error || 'The upload could not be completed.'));
    };
    request.onerror = () => reject(new Error('Connection lost during upload.'));
    request.ontimeout = () => reject(new Error('The upload timed out.'));
    request.send(selected);
  });
}

async function waitForTranscript(id) {
  let failures = 0;
  for (;;) {
    let response;
    try {
      response = await fetch(`/api/jobs/${id}`);
      failures = 0;
    } catch {
      if (++failures > 5) throw new Error('Connection lost while checking transcription.');
    }
    if (response) {
      const job = await response.json();
      if (!response.ok || job.stage === 'failed') {
        throw new Error(job.error || 'The transcription could not be completed.');
      }
      if (job.stage === 'done') return job.result;
      setStatus(job.stage === 'transcribing' ? 'Transcribing with Whisper…' : 'Preparing audio…');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!file || pending) return;
  pending = true;
  media.disabled = true;
  submit.disabled = true;
  progress.value = 0;
  progress.hidden = false;
  setStatus('Uploading…');
  try {
    const id = await upload(file);
    const data = await waitForTranscript(id);
    showTranscript(data, file.name);
    setStatus(data.text ? 'Transcription complete.' : 'No speech was detected.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    progress.hidden = true;
    pending = false;
    media.disabled = false;
    submit.disabled = false;
  }
});

function timecode(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

function setView(showTimestamps) {
  plain.hidden = showTimestamps;
  timed.hidden = !showTimestamps;
  get('plain-view').setAttribute('aria-pressed', String(!showTimestamps));
  get('timed-view').setAttribute('aria-pressed', String(showTimestamps));
}

get('plain-view').addEventListener('click', () => setView(false));
get('timed-view').addEventListener('click', () => setView(true));

function showTranscript(data, filename) {
  transcript = { text: data.text, filename };
  let language = data.language;
  if (language) {
    try {
      language = new Intl.DisplayNames([navigator.language], { type: 'language' }).of(language);
    } catch {
      // Display the model's language code if the browser cannot localize it.
    }
  }
  get('result-meta').textContent = [filename, language].filter(Boolean).join(' · ');
  plain.textContent = data.text || 'No speech was detected in this file.';
  const segments = data.segments.filter((segment) => segment.text.trim());
  timed.replaceChildren(...segments.map((segment) => {
    const item = document.createElement('li');
    const time = document.createElement('span');
    const text = document.createElement('span');
    time.className = 'time-range';
    time.textContent = `${timecode(segment.t0Ms)} – ${timecode(segment.t1Ms)}`;
    text.textContent = segment.text.trim();
    item.append(time, text);
    return item;
  }));
  get('view-controls').hidden = !data.text || segments.length === 0;
  copy.disabled = !data.text;
  get('download').disabled = !data.text;
  clearTimeout(copyReset);
  copy.textContent = 'Copy transcript';
  setView(false);
  result.hidden = false;
  get('transcript-heading').focus();
}

copy.addEventListener('click', async () => {
  const text = transcript.text;
  try {
    await navigator.clipboard.writeText(text);
    copy.textContent = 'Copied';
    get('copy-status').textContent = 'Transcript copied.';
    clearTimeout(copyReset);
    copyReset = setTimeout(() => {
      copy.textContent = 'Copy transcript';
      get('copy-status').textContent = '';
    }, 2000);
  } catch {
    setView(false);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(plain);
    selection.removeAllRanges();
    selection.addRange(range);
    get('copy-status').textContent = 'Transcript selected. Use your device’s copy command.';
  }
});

get('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([transcript.text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${transcript.filename.replace(/\.[^.]+$/, '') || 'transcript'}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
