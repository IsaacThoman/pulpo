# Pulpo Search Quality Evaluation Harness (Phase 0)

Automated quality, relevance, anti-slop, citation-faithfulness, latency, and cost benchmark suite for `search.pulpo.baby`.

## What It Measures

1. **260-Query Golden Dataset** ([dataset.ts](./dataset.ts)) spanning 8 buckets:
   - `navigational` (35) — top-1 & top-3 authoritative domain hit rate
   - `factual` (35) — authoritative encyclopedic/reference answers
   - `technical` (40) — official docs, RFCs, GitHub, systems/engineering guides
   - `academic` (30) — arXiv, ACM, IEEE, Nature, Science, OpenAlex papers
   - `news` (30) — recency-sensitive news coverage
   - `local` (30) — local places intent recall (`apps/search/src/places.ts`)
   - `instant` (30) — zero-click instant answer accuracy (`apps/search/src/instant-answer.ts` + `currency.ts`)
   - `adversarial_slop` (30) — SEO-farm, affiliate-mill, and AI-slop-prone queries

2. **Deterministic IR & Efficiency Metrics** ([metrics.ts](./metrics.ts)):
   - `NDCG@10`, `MRR`, navigational Top-1 / Top-3 hit rate, zero-result rate
   - Canonical duplicate rate (normalizing `www.`/`m.`/`amp.`, tracking params, trailing slashes)
   - Known SEO/AI-slop ratio at top-10
   - Live `apps/search` instant-answer accuracy & local-intent recall
   - Latency (`p50`, `p90`, `p95`, `mean`) and cost per 1,000 searches

3. **Pluggable Relevance, Anti-Slop & Citation Judges** ([judges.ts](./judges.ts)):
   - **Local Baseten Decision Models** (`baselabs/joey-1`, `baselabs/elephant-1`, `baselabs/groundhog-1`, `baselabs/mammoth-1`) via [baseten-server.py](./baseten-server.py) — evaluates graded relevance (`0–3` `score`) **and** SEO/AI-slop (`noul`) in **one shared-prefix prefill** with calibrated probabilities.
   - **OpenAI-Compatible LLM Judge** (e.g., `claude-haiku-5.5` on `https://pulpo.baby/v1`).
   - **Offline Heuristic Judge** for zero-network CI sanity checks.

## Verified Phase 0 Baseline Results (`dev` @ `acac21d87`)

### Local Baseten Decision Model (`baselabs/joey-1`, 2B, Apple Silicon MPS `bfloat16`) vs `claude-haiku-5.5`

Measured head-to-head on 31 SERP result judgments + 8 Quick Answer citation-faithfulness cases (see [baseline-report.json](./baseline-report.json)):

| Metric | `claude-haiku-5.5` (`pulpo.baby/v1`) | Local `baselabs/joey-1` (MPS) |
|---|---:|---:|
| **p50 Judgment Latency** | 1,555.8 ms | **169.2 ms (9.2× faster)** |
| **p90 Judgment Latency** | 2,812.8 ms | **183.8 ms (15.3× faster)** |
| **Cost / 1,000 Judgments** | $1.07 | **$0.00 local** (~$0.002 hosted) |
| **Exact Relevance Agreement** | baseline | **64.5%** |
| **Within-1 Relevance Agreement** | baseline | **93.6%** |
| **Spearman Rank Correlation (ρ)** | baseline | **0.857** |
| **Quadratic-Weighted Kappa (κ)** | baseline | **0.833** |
| **Anti-Slop Binary Agreement** | baseline | **87.1%** |
| **Citation Faithfulness Accuracy** | 100.0% (8/8) | **87.5% (7/8)** |

**Takeaway:** Local `baselabs/joey-1` is **9–15× faster** and **$0 locally** with strong inter-rater agreement (`κ = 0.833`, `ρ = 0.857`) and sharply calibrated slop probabilities (e.g. `0.03–0.12` on NIST/Wikipedia/Postgres docs vs `0.80–0.96` on SEO farms/scraper clones). Use `joey-1` for rapid inner-loop iteration and high-volume sweeps, and `claude-haiku-5.5` (or `elephant-1`/`mammoth-1`) for release-gate verification and citation-faithfulness checks.

### Deterministic Codebase Baseline (Before Sprints 1–4)

| Metric | Phase 0 Baseline | Target After Overhaul |
|---|---:|---:|
| **Instant Answer Accuracy** (30 queries) | **63.3%** (19/30) | ≥ 95% (Sprint 3) |
| **Local Places Intent Recall** (30 queries) | **53.3%** (16/30) | ≥ 95% (Sprint 4) |
| **Adversarial Slop Fixture NDCG@10** | **0.7957** (MRR 0.6667) | ≥ 0.95 (Sprint 2) |
| **Fixture Canonical Duplicate Rate** | **3.13%** | 0.00% (Sprint 2) |

## Usage

### Run unit tests (Node 24+ native TypeScript)
```sh
node --test scripts/benchmarks/search-eval/search-eval.test.ts
```

### Run offline fixture baseline
```sh
node scripts/benchmarks/search-eval/run.ts --mode fixtures --judge heuristic
```

### Spin up local Baseten `baselabs/joey-1` decision server (Apple Silicon MPS / CUDA / CPU)
```sh
mkdir -p /tmp/baselabs-eval && cd /tmp/baselabs-eval
uv venv --python 3.12 .venv && source .venv/bin/activate
uv pip install torch transformers accelerate huggingface_hub hf_xet brotli httpx fastapi uvicorn pydantic einops safetensors tokenizers pillow protobuf
python -c "from huggingface_hub import snapshot_download; snapshot_download('baselabs/joey-1', local_dir='joey-1')"
git clone https://github.com/OmniJev/OneJev.git && git -C OneJev checkout 81ce62f1597c91e46767d4d02d6ac2e18534fe94 && git -C OneJev apply /tmp/baselabs-eval/joey-1/serve.patch
uv pip install --no-deps -e ./OneJev
python /path/to/pulpo/scripts/benchmarks/search-eval/baseten-server.py --model /tmp/baselabs-eval/joey-1 --device auto --port 8787
```

### Compare local `baselabs/joey-1` vs `claude-haiku-5.5`
```sh
SEARCH_EVAL_OPENAI_API_KEY="<key>" \
node scripts/benchmarks/search-eval/run.ts \
  --mode compare-judges \
  --baseline haiku \
  --candidate baseten \
  --baseten-url http://127.0.0.1:8787 \
  --baseten-model baselabs/joey-1
```

### Run live benchmark against a Pulpo Search server
```sh
SEARCH_EVAL_COOKIE="__Host-pulpo_session_search=..." \
SEARCH_EVAL_ORIGIN="https://search.pulpo.baby" \
node scripts/benchmarks/search-eval/run.ts \
  --mode live \
  --target https://search.pulpo.baby \
  --limit 50 \
  --judge baseten
```
