"""Report generation helper."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .metrics import MetricsReport


def render_report_stub(metrics: MetricsReport) -> str:
    """Build a full lab report from the metrics, filling the template in reports/.

    Sections:
    1. Header (name, repo, date)
    2. Architecture overview
    3. State schema table
    4. Scenario results table
    5. Failure analysis
    6. Persistence / recovery evidence
    7. Extension work
    8. Improvement plan
    """
    lines = [
        "# Day 08 Lab Report",
        "",
        "## 1. Team / Student",
        "",
        "- Name: [student name]",
        "- Repo/commit: [git repo URL / commit hash]",
        f"- Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
        "",
        "## 2. Architecture",
        "",
        "### Graph Nodes",
        "",
        "| Node | Purpose |",
        "|---|---|",
        "| intake | Normalize query, detect PII, extract metadata |",
        "| classify | Route query to: simple / tool / missing_info / risky / error |",
        "| clarify | Request missing information when query is too vague |",
        "| tool | Execute mock tool (simulates retries for error routes) |",
        "| evaluate | Done-check: retry if failure patterns detected, else proceed |",
        "| risky_action | Build structured action proposal with evidence |",
        "| approval | Human-in-the-loop approval (mock or interrupt-based) |",
        "| retry | Increment attempt, attach exponential backoff metadata |",
        "| dead_letter | Log unresolvable failures with P1/P2 priority |",
        "| finalize | Emit final audit event |",
        "",
        "### Routing Logic",
        "",
        "Priority order for classification:",
        "1. **RISKY** — destructive/irreversible keywords (refund, delete, send, cancel ...)",
        "2. **TOOL** — information retrieval keywords (status, order, lookup, find ...)",
        "3. **MISSING_INFO** — vague queries with placeholders (it, this, that, <4 words)",
        "4. **ERROR** — system failure keywords (timeout, fail, error, crash ...)",
        "5. **SIMPLE** — everything else (how-to, FAQ, informational)",
        "",
        "### Failure Strategy",
        "",
        "Three layers: retry (bounded by max_attempts) → dead-letter (escalate) → manual review.",
        "",
        "## 3. State Schema",
        "",
        "| Field | Reducer | Why |",
        "|---|---|---|",
        "| messages | append | Append-only audit of conversation |",
        "| tool_results | append | Append-only record of tool calls |",
        "| errors | append | Append-only error log |",
        "| events | append | Append-only LabEvent audit log |",
        "| route | overwrite | Current route only; historical route in events |",
        "| risk_level | overwrite | Latest risk level |",
        "| attempt | overwrite | Retry counter |",
        "| final_answer | overwrite | One final answer per run |",
        "| proposed_action | overwrite | One action awaiting approval |",
        "| approval | overwrite | One approval decision per run |",
        "| evaluation_result | overwrite | Latest evaluation |",
        "",
        "## 4. Scenario Results",
        "",
        f"- Total scenarios: **{metrics.total_scenarios}**",
        f"- Success rate: **{metrics.success_rate:.2%}**",
        f"- Average nodes visited: **{metrics.avg_nodes_visited:.2f}**",
        f"- Total retries: **{metrics.total_retries}**",
        f"- Total interrupts (HITL): **{metrics.total_interrupts}**",
        "",
        "| Scenario | Expected Route | Actual Route | Success | Retries | Interrupts |",
        "|---|---|---|---:|---:|---:|",
    ]

    for m in metrics.scenario_metrics:
        success_icon = "PASS" if m.success else "FAIL"
        lines.append(
            f"| {m.scenario_id} | {m.expected_route} | {m.actual_route or 'N/A'} | "
            f"{success_icon} | {m.retry_count} | {m.interrupt_count} |"
        )

    lines += [
        "",
        "## 5. Failure Analysis",
        "",
        "### Failure Mode 1: Retry / Tool Failure",
        "",
        "The `tool_node` simulates transient failures for error-route scenarios. "
        "The `evaluate_node` detects failure patterns using regex (ERROR, FAILED, HTTP 4xx/5xx, "
        "timeout, unavailable, Traceback, Exception ...) and routes to `retry` when `needs_retry` "
        "is returned. The retry counter increments with each attempt and exponential backoff "
        "metadata (1s → 2s → 4s ... capped at 60s) is attached to the event so observability "
        "systems can schedule the next attempt. Once `attempt >= max_attempts`, "
        "`route_after_retry` redirects to `dead_letter`.",
        "",
        "### Failure Mode 2: Risky Action Without Approval",
        "",
        "Any query containing risky keywords (refund, delete, send, cancel, suspend ...) is "
        "classified as `RISKY` with `risk_level = high`. The `risky_action_node` builds a "
        "structured JSON proposal with action type, evidence, severity, and reversibility "
        "assessment. The `approval_node` then gates execution — either via mock (CI/default) "
        "or real `interrupt()` when `LANGGRAPH_INTERRUPT=true`. If the reviewer rejects or "
        "times out (`LANGGRAPH_APPROVAL_TIMEOUT_SECONDS`), the graph routes back to `clarify` "
        "instead of executing the action.",
        "",
        "## 6. Persistence / Recovery Evidence",
        "",
        "The `build_checkpointer()` factory supports three backends:",
        "",
        "| Kind | Use Case |",
        "|---|---|",
        "| `memory` | Dev / CI (default) |",
        "| `sqlite` | Local persistence, crash recovery, time-travel |",
        "| `postgres` | Production multi-threaded deployments |",
        "",
        "Thread IDs are derived from scenario IDs (`thread-{scenario_id}`), so each scenario "
        "has an isolated checkpoint history. To resume a crashed run, replay the graph with the "
        "same `thread_id` and the checkpointer replays from the last checkpoint automatically.",
        "",
        "**SQLite note:** `SqliteSaver(conn=sqlite3.connect(...))` is used (not "
        "`from_conn_string()` which returns a context manager).",
        "",
        "## 7. Extension Work",
        "",
        "List any completed extensions here:",
        "- [ ] SQLite/Postgres persistence with crash recovery demo",
        "- [ ] Time-travel / replay from checkpoint",
        "- [ ] Parallel fan-out for multi-tool queries",
        "- [ ] Real HITL interrupt demo",
        "- [x] Graph diagram export (`langgraph visualize`)",
        "- [ ] Structured tool result schema",
        "",
        "## 8. Improvement Plan",
        "",
        "If I had one more day, I would productionize in this order:",
        "",
        "1. **Replace mock tool with real API client** — add structured tool result schema, "
        "idempotency keys, and circuit breaker",
        "2. **LLM-as-judge for evaluation** — replace regex with an LLM that scores tool "
        "output quality and decides retry vs. answer",
        "3. **Structured proposed_action model** — use a Pydantic model instead of JSON "
        "string so the approval UI can render fields",
        "4. **Real Postgres checkpointer** — switch from SQLite to PostgresSaver for "
        "multi-instance deployments",
        "5. **Observability** — emit OpenTelemetry traces from each node and integrate "
        "with LangSmith for debugging",
    ]

    return "\n".join(lines)


def write_report(metrics: MetricsReport, output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report_stub(metrics), encoding="utf-8")
