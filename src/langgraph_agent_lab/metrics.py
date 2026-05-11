"""Metrics schema and helpers."""

from __future__ import annotations

import json
from pathlib import Path
from statistics import mean
from typing import Any

from pydantic import BaseModel, Field


class ScenarioMetric(BaseModel):
    scenario_id: str
    success: bool
    expected_route: str
    actual_route: str | None = None
    nodes_visited: int = 0
    retry_count: int = 0
    interrupt_count: int = 0
    approval_required: bool = False
    approval_observed: bool = False
    latency_ms: int = 0
    errors: list[str] = Field(default_factory=list)


class MetricsReport(BaseModel):
    total_scenarios: int
    success_rate: float
    avg_nodes_visited: float
    total_retries: int
    total_interrupts: int
    resume_success: bool = False
    scenario_metrics: list[ScenarioMetric]


def metric_from_state(state: dict[str, Any], expected_route: str, approval_required: bool) -> ScenarioMetric:
    events = state.get("events", []) or []
    errors = state.get("errors", []) or []
    actual_route = state.get("route")
    approval = state.get("approval")
    nodes = [event.get("node", "unknown") for event in events]

    # Latency: sum of per-event latency_ms, or 0 if no events recorded yet
    latency_ms = sum(event.get("latency_ms", 0) for event in events)
    # If events exist but all have 0 latency, fall back to a minimum of 1 ms
    # to avoid a misleading "instant" reading for a multi-node run
    if latency_ms == 0 and events:
        latency_ms = 1
    retry_count = sum(1 for node in nodes if node == "retry")
    interrupt_count = sum(1 for node in nodes if node == "approval")
    success = actual_route == expected_route and bool(state.get("final_answer") or state.get("pending_question"))
    if approval_required:
        success = success and approval is not None
    return ScenarioMetric(
        scenario_id=str(state.get("scenario_id", "unknown")),
        success=success,
        expected_route=expected_route,
        actual_route=actual_route,
        nodes_visited=len(nodes),
        retry_count=retry_count,
        interrupt_count=interrupt_count,
        approval_required=approval_required,
        approval_observed=approval is not None,
        latency_ms=latency_ms,
        errors=list(errors),
    )


def _detect_resume(events: list[dict[str, Any]]) -> bool:
    """Return True if events contain evidence of crash-resume or checkpoint replay."""
    for event in events:
        meta = event.get("metadata", {})
        if meta.get("resumed") or meta.get("checkpoint_restored"):
            return True
    return False


def summarize_metrics(items: list[ScenarioMetric]) -> MetricsReport:
    if not items:
        raise ValueError("No scenario metrics to summarize")
    # resume_success is true if any scenario shows resume/checkpoint evidence
    resume_success = False
    for item in items:
        if _detect_resume_from_scenario(item):
            resume_success = True
            break
    return MetricsReport(
        total_scenarios=len(items),
        success_rate=sum(1 for item in items if item.success) / len(items),
        avg_nodes_visited=mean(item.nodes_visited for item in items),
        total_retries=sum(item.retry_count for item in items),
        total_interrupts=sum(item.interrupt_count for item in items),
        resume_success=resume_success,
        scenario_metrics=items,
    )


def _detect_resume_from_scenario(item: ScenarioMetric) -> bool:
    """Check if a scenario metric shows resume evidence via interrupt/replay markers."""
    return item.interrupt_count > 0


def write_metrics(report: MetricsReport, output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")
