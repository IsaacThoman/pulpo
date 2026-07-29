import { useState } from 'react'
import {
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

const SEARCH_ENGINES = [
  'searxng', 'google_pse', 'brave', 'kagi', 'mojeek', 'serpapi', 'serper', 'tavily',
  'jina', 'bing', 'exa', 'perplexity', 'duckduckgo', 'firecrawl', 'external',
] as const

export function WebSearchSection() {
  const [enabled, setEnabled] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [engine, setEngine] = useState<(typeof SEARCH_ENGINES)[number]>('tavily')
  const [resultCount, setResultCount] = useState(5)
  const [concurrent, setConcurrent] = useState(10)
  const [domainFilter, setDomainFilter] = useState('')
  const [bypassRag, setBypassRag] = useState(false)
  const [bypassLoader, setBypassLoader] = useState(false)
  const [loader, setLoader] = useState('default')

  const keyEngines = ['brave', 'kagi', 'mojeek', 'serpapi', 'serper', 'tavily', 'exa', 'jina', 'firecrawl'] as const

  return (
    <div>
      <Section title="General">
        <Toggle label="Web search" checked={enabled} onChange={setEnabled} />
        {enabled && (
          <>
            <Toggle label="Web search confirmation" hint="Ask before running a search." checked={confirm} onChange={setConfirm} indent />
            <SelectField
              label="Web search engine"
              value={engine}
              onChange={setEngine}
              options={SEARCH_ENGINES.map((e) => ({
                value: e,
                label: e === 'duckduckgo' ? 'DDGS (duckduckgo)' : e,
              }))}
            />
            {engine === 'searxng' && (
              <>
                <TextField label="SearXNG query URL" value="https://searx.kimi.dev/search?q=<query>" onChange={() => {}} mono indent />
                <TextField label="Search language" value="en" onChange={() => {}} indent />
              </>
            )}
            {engine === 'google_pse' && (
              <>
                <SecretField label="Google PSE API key" value="" onChange={() => {}} indent />
                <TextField label="Engine ID" value="" onChange={() => {}} indent />
              </>
            )}
            {(keyEngines as readonly string[]).includes(engine) && (
              <SecretField label={`${engine} API key`} value="tvly-••••••••" onChange={() => {}} indent />
            )}
            {engine === 'perplexity' && (
              <>
                <SecretField label="Perplexity API key" value="" onChange={() => {}} indent />
                <SelectField
                  label="Perplexity model"
                  value="sonar-pro"
                  onChange={() => {}}
                  options={['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research'].map(
                    (m) => ({ value: m, label: m })
                  )}
                  indent
                />
                <SelectField
                  label="Search context usage"
                  value="medium"
                  onChange={() => {}}
                  options={[
                    { value: 'low', label: 'low' },
                    { value: 'medium', label: 'medium' },
                    { value: 'high', label: 'high' },
                  ]}
                  indent
                />
              </>
            )}
            {engine === 'bing' && (
              <>
                <TextField label="Bing V7 endpoint" value="https://api.bing.microsoft.com/v7.0/search" onChange={() => {}} mono indent />
                <SecretField label="Subscription key" value="" onChange={() => {}} indent />
              </>
            )}
            {engine === 'external' && (
              <>
                <TextField label="Web search URL" value="" onChange={() => {}} mono indent />
                <SecretField label="API key" value="" onChange={() => {}} indent />
              </>
            )}
            <NumField label="Search result count" value={resultCount} onChange={setResultCount} />
            <NumField label="Concurrent requests" value={concurrent} onChange={setConcurrent} />
            <TextField
              label="Domain filter list"
              hint="Comma-separated. Prefix with ! to exclude."
              value={domainFilter}
              onChange={setDomainFilter}
              placeholder="wikipedia.org,!pinterest.com"
            />
            <Toggle label="Bypass embedding and retrieval (full context mode)" checked={bypassRag} onChange={setBypassRag} />
            <Toggle label="Bypass web loader" checked={bypassLoader} onChange={setBypassLoader} />
          </>
        )}
      </Section>

      <Section title="Loader">
        <SelectField
          label="Web loader engine"
          value={loader}
          onChange={setLoader}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'playwright', label: 'playwright' },
            { value: 'firecrawl', label: 'firecrawl' },
            { value: 'tavily', label: 'tavily' },
            { value: 'external', label: 'external' },
          ]}
        />
        {loader === 'playwright' && (
          <>
            <TextField label="WebSocket URL" value="ws://localhost:3000" onChange={() => {}} mono indent />
            <NumField label="Timeout (ms)" value={30000} indent />
          </>
        )}
        {loader === 'default' && <Toggle label="Verify SSL certificate" checked={true} onChange={() => {}} indent />}
        <TextField label="YouTube language" value="en" onChange={() => {}} />
        <TextField label="YouTube proxy URL" value="" onChange={() => {}} mono />
      </Section>

      <SaveBar />
    </div>
  )
}

const EXTRACTION_ENGINES = [
  'default', 'external', 'tika', 'docling', 'datalab_marker', 'document_intelligence',
  'mistral_ocr', 'paddleocr_vl', 'mineru',
] as const

export function DocumentsSection() {
  const [engine, setEngine] = useState<(typeof EXTRACTION_ENGINES)[number]>('default')
  const [pdfImages, setPdfImages] = useState(false)
  const [splitter, setSplitter] = useState('default')
  const [headerSplitter, setHeaderSplitter] = useState(true)
  const [chunkSize, setChunkSize] = useState(1500)
  const [chunkOverlap, setChunkOverlap] = useState(100)
  const [embedEngine, setEmbedEngine] = useState('default')
  const [embedModel, setEmbedModel] = useState('sentence-transformers/all-MiniLM-L6-v2')
  const [batchSize, setBatchSize] = useState(32)
  const [hybrid, setHybrid] = useState(true)
  const [reranker, setReranker] = useState('BAAI/bge-reranker-v2-m3')
  const [topK, setTopK] = useState(5)
  const [template, setTemplate] = useState(
    'Use the following context to answer the question.\n\n<context>\n{{CONTEXT}}\n</context>\n\nQuestion: {{QUERY}}'
  )

  return (
    <div>
      <Section title="General">
        <SelectField
          label="Content extraction engine"
          value={engine}
          onChange={setEngine}
          options={EXTRACTION_ENGINES.map((e) => ({
            value: e,
            label: e === 'default' ? 'Default' : e.replace(/_/g, ' '),
          }))}
        />
        {engine === 'default' && (
          <Toggle label="PDF extract images (OCR)" checked={pdfImages} onChange={setPdfImages} indent />
        )}
        {engine === 'tika' && <TextField label="Tika server URL" value="http://localhost:9998" onChange={() => {}} mono indent />}
        {(engine === 'mistral_ocr' || engine === 'datalab_marker' || engine === 'docling') && (
          <>
            <TextField label="API base URL" value="" onChange={() => {}} mono indent />
            <SecretField label="API key" value="" onChange={() => {}} indent />
          </>
        )}
        <SelectField
          label="Text splitter"
          value={splitter}
          onChange={setSplitter}
          options={[
            { value: 'default', label: 'Default (character)' },
            { value: 'tiktoken', label: 'Token (tiktoken)' },
            { value: 'transformers', label: 'Token (transformers)' },
          ]}
        />
        <Toggle label="Markdown header text splitter" checked={headerSplitter} onChange={setHeaderSplitter} />
        <NumField label="Chunk size" value={chunkSize} onChange={setChunkSize} />
        <NumField label="Chunk overlap" value={chunkOverlap} onChange={setChunkOverlap} />
      </Section>

      <Section title="Embedding">
        <SelectField
          label="Embedding model engine"
          value={embedEngine}
          onChange={setEmbedEngine}
          options={[
            { value: 'default', label: 'Default (SentenceTransformers)' },
            { value: 'ollama', label: 'Ollama' },
            { value: 'openai', label: 'OpenAI' },
            { value: 'azure', label: 'Azure OpenAI' },
          ]}
        />
        {(embedEngine === 'openai' || embedEngine === 'ollama') && (
          <>
            <TextField label="API base URL" value="" onChange={() => {}} mono indent />
            <SecretField label="API key" value="" onChange={() => {}} indent />
          </>
        )}
        <TextField label="Embedding model" value={embedModel} onChange={setEmbedModel} mono />
        <NumField label="Embedding batch size" value={batchSize} onChange={setBatchSize} />
      </Section>

      <Section title="Retrieval">
        <Toggle label="Hybrid search" checked={hybrid} onChange={setHybrid} />
        {hybrid && (
          <>
            <Toggle label="Enrich hybrid search text" checked={true} onChange={() => {}} indent />
            <TextField label="Reranking model" value={reranker} onChange={setReranker} mono indent />
          </>
        )}
        <NumField label="Top K" value={topK} onChange={setTopK} />
        {hybrid && <NumField label="Relevance threshold" value={0.4} indent />}
        <TextAreaField label="RAG template" value={template} onChange={setTemplate} mono rows={5} />
      </Section>

      <Section title="Files">
        <TextField label="Allowed file extensions" value="pdf,docx,txt,md,csv,epub" onChange={() => {}} />
        <NumField label="Max upload size" value={100} suffix="MB" />
        <NumField label="Max upload count" value={20} />
        <NumField label="Image compression width" value={1280} suffix="px" />
        <NumField label="Image compression height" value={1280} suffix="px" />
      </Section>

      <Section title="Integration">
        <Toggle label="Google Drive" checked={false} onChange={() => {}} />
        <Toggle label="OneDrive" checked={false} onChange={() => {}} />
      </Section>

      <Section title="Danger zone" danger>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm">
            Reset upload directory
          </Button>
          <Button variant="outline" size="sm">
            Reset vector storage / knowledge
          </Button>
          <Button variant="destructive" size="sm">
            Reindex knowledge base vectors
          </Button>
        </div>
      </Section>

      <SaveBar />
    </div>
  )
}
