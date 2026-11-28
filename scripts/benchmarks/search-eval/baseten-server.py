#!/usr/bin/env python3
"""
Local HTTP server for Baseten Base Labs open-weight decision models
(e.g., baselabs/joey-1, baselabs/elephant-1, baselabs/groundhog-1, baselabs/mammoth-1).

Exposes:
  GET  /health  -> model & device info
  POST /decide  -> { state, questions } -> calibrated decision answers + wall latency

Runs natively on CUDA, Apple Silicon MPS, or CPU via OneJev's DecisionEngine.
"""
from __future__ import annotations

import argparse
import os
import time
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from qev.engine import DecisionEngine
from qev.schema import SystemOneRequest


class DecideRequest(BaseModel):
    state: Any
    questions: dict[str, dict[str, Any]]
    model: str | None = None


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda:0"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def create_app(model_path: str, device: str, fork_mode: str) -> FastAPI:
    app = FastAPI(title="Pulpo Search Eval — Local Baseten Decision Server")
    resolved_device = pick_device(device)
    print(f"[baseten-server] Loading {model_path} on {resolved_device} (fork_mode={fork_mode})...", flush=True)
    t0 = time.perf_counter()
    engine = DecisionEngine(model_path, device=resolved_device, fork_mode=fork_mode)
    load_s = time.perf_counter() - t0
    print(f"[baseten-server] Ready in {load_s:.2f}s — info={engine.info}", flush=True)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": model_path,
            "device": str(engine.device),
            "fork_mode": engine.info.fork_mode,
            "model_type": engine.info.model_type,
            "load_seconds": round(load_s, 2),
        }

    @app.post("/decide")
    def decide(req: DecideRequest) -> dict[str, Any]:
        t_start = time.perf_counter()
        try:
            s1 = SystemOneRequest(state=req.state, questions=req.questions)
            resp, meta = engine.decide(s1)
            if engine.device.type == "cuda":
                torch.cuda.synchronize(engine.device)
            elif engine.device.type == "mps":
                torch.mps.synchronize()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        latency_ms = (time.perf_counter() - t_start) * 1000.0
        answers: dict[str, Any] = {}
        for qid, ans in resp.answers.items():
            dumped = ans.model_dump()
            if ans.type == "noul":
                answers[qid] = {"type": "noul", "noul": dumped["noul"]}
            elif ans.type == "score":
                answers[qid] = {
                    "type": "score",
                    "score": dumped["score"],
                    "probabilities": dumped.get("probabilities"),
                }
            else:
                answers[qid] = {
                    "type": "choice",
                    "choice": dumped["choice"],
                    "probabilities": dumped.get("probabilities"),
                }
        input_tokens = getattr(meta, "prefix_tokens", None)
        return {
            "model": model_path,
            "device": str(engine.device),
            "latency_ms": round(latency_ms, 2),
            "input_tokens": input_tokens,
            "answers": answers,
        }

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Baseten decision-model server")
    parser.add_argument("--model", default=os.environ.get("BASETEN_MODEL_PATH", "baselabs/joey-1"))
    parser.add_argument("--device", default=os.environ.get("BASETEN_DEVICE", "auto"))
    parser.add_argument("--fork-mode", default=os.environ.get("BASETEN_FORK_MODE", "sequential"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    app = create_app(args.model, args.device, args.fork_mode)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
