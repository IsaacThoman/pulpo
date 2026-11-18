import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { TranscribeModel } from 'transcribe-cpp';

const modelPath = process.env.WHISPER_MODEL_PATH || join(homedir(), '.t3/userdata/speech/models/whisper-large-v3-turbo-Q8_0.gguf');
const [input, output] = process.argv.slice(2);
const bundledLibrary = process.env.TRANSCRIBE_LIBRARY;
if (bundledLibrary) {
  // T3 can update independently. Keep the bindings and native ABI in sync.
  const contract = await readFile(join(dirname(bundledLibrary), 'contract.json'), 'utf8')
    .then(JSON.parse).catch(() => null);
  if (contract?.header_hash !== 'f99ad4169374b8f3') delete process.env.TRANSCRIBE_LIBRARY;
}
const pcm = await readFile(input);
const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
const model = await TranscribeModel.load(modelPath, { backend: 'metal' });

try {
  const { text, language, segments } = await model.transcribe(samples, { timestamps: 'segment' });
  await writeFile(output, JSON.stringify({ text: text.trim(), language, segments }));
} finally {
  model.dispose();
}
