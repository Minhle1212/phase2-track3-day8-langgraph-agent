"""FastAPI server exposing the LangGraph agent as REST/WebSocket endpoints."""

from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..graph import build_graph
from ..metrics import metric_from_state, write_metrics, MetricsReport, ScenarioMetric, summarize_metrics
from ..persistence import build_checkpointer
from ..scenarios import load_scenarios
from ..state import AgentState, Route, Scenario, initial_state


# ── App lifespan: build graph once ────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = yaml.safe_load(Path("configs/lab.yaml").read_text(encoding="utf-8"))
    checkpointer = build_checkpointer(cfg.get("checkpointer", "sqlite"), cfg.get("database_url"))
    app.state.graph = build_graph(checkpointer=checkpointer)
    app.state.checkpointer = checkpointer
    app.state.cfg = cfg
    yield


app = FastAPI(
    title="LangGraph Agent API",
    version="1.0.0",
    description="REST + SSE interface for the Day-08 LangGraph agent",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request / Response models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    thread_id: str | None = None
    scenario_id: str | None = None
    checkpointer: str = "memory"


class ChatResponse(BaseModel):
    thread_id: str
    final_answer: str | None
    route: str
    risk_level: str
    attempt: int
    nodes_visited: list[str]
    tool_results: list[str]
    errors: list[str]
    events: list[dict[str, Any]]
    pending_question: str | None = None
    proposed_action: str | None = None
    approval: dict[str, Any] | None = None


class ApprovalRequest(BaseModel):
    thread_id: str
    approved: bool
    comment: str = ""


class ScenariosResponse(BaseModel):
    scenarios: list[Scenario]
    total: int


class MetricResponse(BaseModel):
    scenario_id: str
    success: bool
    expected_route: str
    actual_route: str | None
    nodes_visited: int
    retry_count: int
    approval_required: bool
    approval_observed: bool
    latency_ms: int


class RunAllResponse(BaseModel):
    report: MetricsReport
    output_path: str


class HistoryResponse(BaseModel):
    checkpoints: list[dict[str, Any]]


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/scenarios", response_model=ScenariosResponse)
def get_scenarios():
    cfg = Path("configs/lab.yaml").read_text(encoding="utf-8")
    cfg_dict = yaml.safe_load(cfg)
    scenarios = load_scenarios(cfg_dict["scenarios_path"])
    return ScenariosResponse(scenarios=scenarios, total=len(scenarios))


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Run a single query through the agent graph."""
    graph = app.state.graph
    thread_id = req.thread_id or f"thread-{uuid.uuid4().hex[:8]}"

    # Build initial state
    state: AgentState = {
        "thread_id": thread_id,
        "scenario_id": req.scenario_id or f"chat-{uuid.uuid4().hex[:8]}",
        "query": req.query,
        "route": "",
        "risk_level": "unknown",
        "attempt": 0,
        "max_attempts": 3,
        "final_answer": None,
        "pending_question": None,
        "proposed_action": None,
        "approval": None,
        "evaluation_result": None,
        "messages": [],
        "tool_results": [],
        "errors": [],
        "events": [],
    }

    config = {"configurable": {"thread_id": thread_id}}
    try:
        final_state = graph.invoke(state, config=config)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    events = final_state.get("events", []) or []
    nodes_visited = [e.get("node", "unknown") for e in events]

    return ChatResponse(
        thread_id=thread_id,
        final_answer=final_state.get("final_answer"),
        route=final_state.get("route", ""),
        risk_level=final_state.get("risk_level", "unknown"),
        attempt=final_state.get("attempt", 0),
        nodes_visited=nodes_visited,
        tool_results=final_state.get("tool_results", []) or [],
        errors=final_state.get("errors", []) or [],
        events=events,
        pending_question=final_state.get("pending_question"),
        proposed_action=final_state.get("proposed_action"),
        approval=final_state.get("approval"),
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream agent events as SSE."""
    graph = app.state.graph
    thread_id = req.thread_id or f"thread-{uuid.uuid4().hex[:8]}"

    state: AgentState = {
        "thread_id": thread_id,
        "scenario_id": req.scenario_id or f"chat-{uuid.uuid4().hex[:8]}",
        "query": req.query,
        "route": "",
        "risk_level": "unknown",
        "attempt": 0,
        "max_attempts": 3,
        "final_answer": None,
        "pending_question": None,
        "proposed_action": None,
        "approval": None,
        "evaluation_result": None,
        "messages": [],
        "tool_results": [],
        "errors": [],
        "events": [],
    }

    config = {"configurable": {"thread_id": thread_id}}

    async def event_generator():
        # Snapshot state before invoke
        yield f"data: {json.dumps({'type': 'start', 'thread_id': thread_id})}\n\n"

        # Use astream to stream through graph steps
        try:
            async for event in graph.astream(state, config=config):
                for node_name, node_state in event.items():
                    payload = {
                        "type": "node",
                        "node": node_name,
                        "state": {
                            "route": node_state.get("route"),
                            "risk_level": node_state.get("risk_level"),
                            "attempt": node_state.get("attempt"),
                            "final_answer": node_state.get("final_answer"),
                            "pending_question": node_state.get("pending_question"),
                            "events": node_state.get("events", []),
                            "errors": node_state.get("errors", []),
                        },
                    }
                    yield f"data: {json.dumps(payload)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'thread_id': thread_id})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/run-all", response_model=RunAllResponse)
def run_all_scenarios():
    """Run all scenarios and return metrics."""
    cfg = Path("configs/lab.yaml").read_text(encoding="utf-8")
    cfg_dict = yaml.safe_load(cfg)
    scenarios = load_scenarios(cfg_dict["scenarios_path"])
    graph = app.state.graph

    metrics: list[ScenarioMetric] = []
    for scenario in scenarios:
        state = initial_state(scenario)
        config = {"configurable": {"thread_id": state["thread_id"]}}
        final_state = graph.invoke(state, config=config)
        metrics.append(
            metric_from_state(final_state, scenario.expected_route.value, scenario.requires_approval)
        )

    report = summarize_metrics(metrics)
    output_path = "outputs/api_metrics.json"
    write_metrics(report, output_path)

    return RunAllResponse(report=report, output_path=output_path)


@app.get("/metrics", response_model=MetricsReport)
def get_metrics():
    """Return cached metrics from last run."""
    path = Path("outputs/api_metrics.json")
    if not path.exists():
        raise HTTPException(status_code=404, detail="No metrics found. Run /run-all first.")
    data = json.loads(path.read_text(encoding="utf-8"))
    return MetricsReport.model_validate(data)


@app.get("/history/{thread_id}", response_model=HistoryResponse)
def get_history(thread_id: str):
    """Get checkpoint history for a thread."""
    checkpointer = app.state.checkpointer
    if checkpointer is None:
        raise HTTPException(status_code=400, detail="No checkpointer configured")

    try:
        from langgraph.checkpoint.base import get_checkpoint
        all_checkpoints = []
        # Walk all channel snapshots for the thread
        config = {"configurable": {"thread_id": thread_id}}
        # list method exists on checkpointer
        if hasattr(checkpointer, "list"):
            raw_list = checkpointer.list(config)
            for checkpoint_record in raw_list:
                checkpoint = checkpoint_record.checkpoint
                metadata = checkpoint_record.metadata if hasattr(checkpoint_record, "metadata") else {}
                all_checkpoints.append({
                    "checkpoint_id": checkpoint.get("id") if checkpoint else None,
                    "metadata": metadata,
                    "parent_checkpoint_id": checkpoint.get("parent_config", {}).get("configurable", {}).get("checkpoint_id") if checkpoint else None,
                })
        return HistoryResponse(checkpoints=all_checkpoints)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/history/{thread_id}/state/{checkpoint_id}")
def get_history_state(thread_id: str, checkpoint_id: str):
    """Get full state at a specific checkpoint."""
    checkpointer = app.state.checkpointer
    if checkpointer is None:
        raise HTTPException(status_code=400, detail="No checkpointer configured")

    try:
        from langgraph.checkpoint.base import get_checkpoint
        config = {"configurable": {"thread_id": thread_id, "checkpoint_id": checkpoint_id}}
        record = checkpointer.get(config)
        if record is None:
            raise HTTPException(status_code=404, detail="Checkpoint not found")
        return record.checkpoint
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
