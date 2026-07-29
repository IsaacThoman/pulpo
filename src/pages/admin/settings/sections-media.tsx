import { useState } from 'react'
import {
  Field,
  NumField,
  SaveBar,
  SecretField,
  Section,
  SelectField,
  TextAreaField,
  TextField,
  Toggle,
} from '@/components/admin/kit'
import { Button } from '@/components/ui/button'

export function ImagesSection() {
  const [enabled, setEnabled] = useState(true)
  const [engine, setEngine] = useState('openai')
  const [model, setModel] = useState('gpt-image-1')
  const [size, setSize] = useState('1024x1024')
  const [steps, setSteps] = useState(30)
  const [promptGen, setPromptGen] = useState(true)
  const [editEnabled, setEditEnabled] = useState(false)

  return (
    <div>
      <Section title="General">
        <Toggle label="Image generation" checked={enabled} onChange={setEnabled} />
      </Section>

      {enabled && (
        <Section title="Create image">
          <SelectField
            label="Image generation engine"
            value={engine}
            onChange={setEngine}
            options={[
              { value: 'openai', label: 'Default (OpenAI)' },
              { value: 'comfyui', label: 'ComfyUI' },
              { value: 'automatic1111', label: 'Automatic1111' },
              { value: 'gemini', label: 'Gemini' },
            ]}
          />
          {engine === 'openai' && (
            <>
              <TextField label="API base URL" value="https://api.openai.com/v1" onChange={() => {}} mono indent />
              <SecretField label="API key" value="" onChange={() => {}} indent />
            </>
          )}
          {(engine === 'comfyui' || engine === 'automatic1111') && (
            <>
              <TextField label="Base URL" value="http://localhost:7860" onChange={() => {}} mono indent />
              <div className="pl-4">
                <Button variant="outline" size="sm">
                  Verify connection
                </Button>
              </div>
              {engine === 'automatic1111' && (
                <SecretField label="API auth string" value="" onChange={() => {}} indent />
              )}
            </>
          )}
          {engine === 'gemini' && (
            <>
              <TextField label="Base URL" value="https://generativelanguage.googleapis.com" onChange={() => {}} mono indent />
              <SecretField label="API key" value="" onChange={() => {}} indent />
              <SelectField
                label="Endpoint method"
                value="generateContent"
                onChange={() => {}}
                options={[
                  { value: 'predict', label: 'predict' },
                  { value: 'generateContent', label: 'generateContent' },
                ]}
                indent
              />
            </>
          )}
          <TextField label="Model" value={model} onChange={setModel} />
          <TextField label="Image size" value={size} onChange={setSize} />
          {engine !== 'gemini' && <NumField label="Steps" value={steps} onChange={setSteps} />}
          <Toggle label="Image prompt generation" checked={promptGen} onChange={setPromptGen} />
        </Section>
      )}

      <Section title="Edit image">
        <Toggle label="Image edit" checked={editEnabled} onChange={setEditEnabled} />
        {editEnabled && (
          <>
            <TextField label="Model" value="gpt-image-1" onChange={() => {}} indent />
            <TextField label="Image size" value="1024x1024" onChange={() => {}} indent />
          </>
        )}
      </Section>

      <SaveBar />
    </div>
  )
}

export function AudioSection() {
  const [stt, setStt] = useState('whisper')
  const [tts, setTts] = useState('openai')
  const [splitting, setSplitting] = useState('punctuation')

  return (
    <div>
      <Section title="Speech-to-text">
        <SelectField
          label="STT engine"
          value={stt}
          onChange={setStt}
          options={[
            { value: 'whisper', label: 'Whisper (local)' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'web', label: 'Web API' },
            { value: 'deepgram', label: 'Deepgram' },
            { value: 'azure', label: 'Azure AI Speech' },
            { value: 'mistral', label: 'MistralAI' },
          ]}
        />
        {stt === 'whisper' && (
          <Field label="Whisper model" indent>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 font-mono text-xs">base</code>
              <Button variant="outline" size="sm">
                Update
              </Button>
            </div>
          </Field>
        )}
        {(stt === 'openai' || stt === 'mistral') && (
          <>
            <TextField label="API base URL" value="" onChange={() => {}} mono indent />
            <SecretField label="API key" value="" onChange={() => {}} indent />
            <TextField label="STT model" value={stt === 'mistral' ? 'voxtral-mini-latest' : 'whisper-1'} onChange={() => {}} indent />
          </>
        )}
        {stt === 'deepgram' && <SecretField label="API key" value="" onChange={() => {}} indent />}
        {stt === 'azure' && (
          <>
            <SecretField label="API key" value="" onChange={() => {}} indent />
            <TextField label="Azure region" value="eastus" onChange={() => {}} indent />
            <TextField label="Language locales" value="en-US" onChange={() => {}} indent />
          </>
        )}
        {stt !== 'web' && <TextField label="Supported MIME types" value="audio/*,video/*" onChange={() => {}} />}
      </Section>

      <Section title="Text-to-speech">
        <SelectField
          label="TTS engine"
          value={tts}
          onChange={setTts}
          options={[
            { value: 'web', label: 'Web API' },
            { value: 'transformers', label: 'Transformers (local)' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'elevenlabs', label: 'ElevenLabs' },
            { value: 'azure', label: 'Azure AI Speech' },
            { value: 'mistral', label: 'MistralAI' },
          ]}
        />
        {tts === 'openai' && (
          <>
            <TextField label="API base URL" value="" onChange={() => {}} mono indent />
            <SecretField label="API key" value="" onChange={() => {}} indent />
            <TextField label="TTS voice" value="alloy" onChange={() => {}} indent />
            <TextField label="TTS model" value="tts-1" onChange={() => {}} indent />
          </>
        )}
        {tts === 'elevenlabs' && (
          <>
            <SecretField label="API key" value="" onChange={() => {}} indent />
            <TextField label="Voice" value="Brian" onChange={() => {}} indent />
            <TextField label="Model" value="eleven_multilingual_v2" onChange={() => {}} indent />
          </>
        )}
        {tts === 'azure' && (
          <>
            <SecretField label="API key" value="" onChange={() => {}} indent />
            <TextField label="Azure region" value="eastus" onChange={() => {}} indent />
          </>
        )}
        {tts === 'transformers' && (
          <TextField label="TTS model" value="microsoft/speecht5_tts" onChange={() => {}} mono indent />
        )}
        <SelectField
          label="Response splitting"
          hint="How responses are chunked before synthesis."
          value={splitting}
          onChange={setSplitting}
          options={[
            { value: 'punctuation', label: 'punctuation' },
            { value: 'paragraphs', label: 'paragraphs' },
            { value: 'none', label: 'none' },
          ]}
        />
      </Section>

      <SaveBar />
    </div>
  )
}

export function CodeExecutionSection() {
  const [execEnabled, setExecEnabled] = useState(true)
  const [execEngine, setExecEngine] = useState('pyodide')
  const [interpEnabled, setInterpEnabled] = useState(true)
  const [interpEngine, setInterpEngine] = useState('pyodide')
  const [timeout, setTimeout_] = useState(60)
  const [prompt, setPrompt] = useState(
    'You have access to a sandboxed Python environment. Write code in ```python blocks to run it.'
  )

  const jupyterFields = (
    <>
      <TextField label="Jupyter URL" value="http://localhost:8888" onChange={() => {}} mono indent />
      <SelectField
        label="Jupyter auth"
        value="token"
        onChange={() => {}}
        options={[
          { value: 'none', label: 'None' },
          { value: 'token', label: 'Token' },
          { value: 'password', label: 'Password' },
        ]}
        indent
      />
      <SecretField label="Token" value="" onChange={() => {}} indent />
    </>
  )

  return (
    <div>
      <Section title="Code execution" hint="Run user-authored code blocks.">
        <Toggle label="Enable code execution" checked={execEnabled} onChange={setExecEnabled} />
        {execEnabled && (
          <>
            <SelectField
              label="Code execution engine"
              value={execEngine}
              onChange={setExecEngine}
              options={[
                { value: 'pyodide', label: 'pyodide (in-browser, sandboxed)' },
                { value: 'jupyter', label: 'jupyter (legacy)' },
              ]}
            />
            {execEngine === 'jupyter' && jupyterFields}
          </>
        )}
      </Section>

      <Section title="Code interpreter" hint="Lets models run code to answer questions.">
        <Toggle label="Enable code interpreter" checked={interpEnabled} onChange={setInterpEnabled} />
        {interpEnabled && (
          <>
            <SelectField
              label="Code interpreter engine"
              value={interpEngine}
              onChange={setInterpEngine}
              options={[
                { value: 'pyodide', label: 'pyodide (in-browser, sandboxed)' },
                { value: 'jupyter', label: 'jupyter (legacy)' },
              ]}
            />
            {interpEngine === 'jupyter' && jupyterFields}
            <NumField label="Execution timeout" value={timeout} onChange={setTimeout_} suffix="s" />
            <TextAreaField label="Code interpreter prompt template" value={prompt} onChange={setPrompt} />
          </>
        )}
      </Section>

      <SaveBar />
    </div>
  )
}
