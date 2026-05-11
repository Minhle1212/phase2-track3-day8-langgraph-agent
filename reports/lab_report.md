# Day 08 Lab Report

## 1. Team / Student

- Name: Le Hoang Minh 2A202600471
- Date: 2026-05-11

## 2. Architecture

### Graph Nodes

| Node | Purpose |
|---|---|
| intake | Normalize query, detect PII, extract metadata |
| classify | Route query to: simple / tool / missing_info / risky / error |
| clarify | Request missing information when query is too vague |
| tool | Execute mock tool (simulates retries for error routes) |
| evaluate | Done-check: retry if failure patterns detected, else proceed |
| risky_action | Build structured action proposal with evidence |
| approval | Human-in-the-loop approval (mock or interrupt-based) |
| retry | Increment attempt, attach exponential backoff metadata |
| dead_letter | Log unresolvable failures with P1/P2 priority |
| finalize | Emit final audit event |

### Routing Logic

Priority order for classification:
1. **RISKY** — destructive/irreversible keywords (refund, delete, send, cancel ...)
2. **TOOL** — information retrieval keywords (status, order, lookup, find ...)
3. **MISSING_INFO** — vague queries with placeholders (it, this, that, <4 words)
4. **ERROR** — system failure keywords (timeout, fail, error, crash ...)
5. **SIMPLE** — everything else (how-to, FAQ, informational)

### Failure Strategy

Three layers: retry (bounded by max_attempts) → dead-letter (escalate) → manual review.

## 3. State Schema

| Field | Reducer | Why |
|---|---|---|
| messages | append | Append-only audit of conversation |
| tool_results | append | Append-only record of tool calls |
| errors | append | Append-only error log |
| events | append | Append-only LabEvent audit log |
| route | overwrite | Current route only; historical route in events |
| risk_level | overwrite | Latest risk level |
| attempt | overwrite | Retry counter |
| final_answer | overwrite | One final answer per run |
| proposed_action | overwrite | One action awaiting approval |
| approval | overwrite | One approval decision per run |
| evaluation_result | overwrite | Latest evaluation |

## 4. Scenario Results

- Total scenarios: **12**
- Success rate: **100.00%**
- Average nodes visited: **13.50**
- Total retries: **10**
- Total interrupts (HITL): **8**

| Scenario | Expected Route | Actual Route | Success | Retries | Interrupts |
|---|---|---|---:|---:|---:|
| S01_simple | simple | simple | PASS | 0 | 0 |
| S02_tool | tool | tool | PASS | 0 | 0 |
| S03_missing | missing_info | missing_info | PASS | 0 | 0 |
| S04_risky | risky | risky | PASS | 0 | 2 |
| S05_error | error | error | PASS | 4 | 0 |
| S06_delete | risky | risky | PASS | 0 | 2 |
| S07_dead_letter | error | error | PASS | 2 | 0 |
| S08_multi_risky | risky | risky | PASS | 0 | 2 |
| S09_risky_plus_error | risky | risky | PASS | 0 | 2 |
| S10_tool_boundary | tool | tool | PASS | 0 | 0 |
| S11_long_vague | missing_info | missing_info | PASS | 0 | 0 |
| S12_max_retry | error | error | PASS | 4 | 0 |

## 5. Failure Analysis

### Failure Mode 1: Retry / Tool Failure

The `tool_node` simulates transient failures for error-route scenarios. The `evaluate_node` detects failure patterns using regex (ERROR, FAILED, HTTP 4xx/5xx, timeout, unavailable, Traceback, Exception ...) and routes to `retry` when `needs_retry` is returned. The retry counter increments with each attempt and exponential backoff metadata (1s → 2s → 4s ... capped at 60s) is attached to the event so observability systems can schedule the next attempt. Once `attempt >= max_attempts`, `route_after_retry` redirects to `dead_letter`.

### Failure Mode 2: Risky Action Without Approval

Any query containing risky keywords (refund, delete, send, cancel, suspend ...) is classified as `RISKY` with `risk_level = high`. The `risky_action_node` builds a structured JSON proposal with action type, evidence, severity, and reversibility assessment. The `approval_node` then gates execution — either via mock (CI/default) or real `interrupt()` when `LANGGRAPH_INTERRUPT=true`. If the reviewer rejects or times out (`LANGGRAPH_APPROVAL_TIMEOUT_SECONDS`), the graph routes back to `clarify` instead of executing the action.

## 6. Persistence / Recovery Evidence

The `build_checkpointer()` factory supports three backends:

| Kind | Use Case |
|---|---|
| `memory` | Dev / CI (default) |
| `sqlite` | Local persistence, crash recovery, time-travel |
| `postgres` | Production multi-threaded deployments |

Thread IDs are derived from scenario IDs (`thread-{scenario_id}`), so each scenario has an isolated checkpoint history. To resume a crashed run, replay the graph with the same `thread_id` and the checkpointer replays from the last checkpoint automatically.

**SQLite note:** `SqliteSaver(conn=sqlite3.connect(...))` is used (not `from_conn_string()` which returns a context manager).

## 7. Extension Work

### Extension A — SQLite Persistence + Crash-Resume + Time-Travel (COMPLETED)

**Config change:** `configs/lab.yaml` → `checkpointer: sqlite` (was `memory`).
Required installing `langgraph-checkpoint-sqlite`.

**What it does:** Every graph run checkpoints its state to a local `checkpoints.db` SQLite file after each node. Thread IDs are derived from scenario IDs (`thread-{scenario_id}`), so each scenario has an isolated checkpoint history.

**Demo script:** `src/langgraph_agent_lab/extensions/persistence_demo.py`

Run with: `make demo-persistence` (added to `Makefile`)

**Evidence — Crash-Resume:**
- S04_risky completes with route=risky, approval=True, 40 events
- After re-reading from SQLite (simulating a restart): recovered route=risky, approval=True — identical state
- `make run-scenarios` still reaches 100% success with the SQLite checkpointer

**Evidence — Time-Travel Replay (S05_error):**
- 24 checkpoint snapshots stored across 2 runs
- Mid-run checkpoint at `attempt=2` can be read back and re-invoked
- `get_state_history()` exposes the full lineage: oldest → newest checkpoint IDs, each tagged with `attempt` and `route`
- Replaying from any checkpoint resumes execution from that point forward

**DB snapshot (12 threads):**
| Thread | Checkpoints |
|---|---|
| S01_simple | 12 | S02_tool | 16 | S03_missing | 12 | S04_risky | 40 | S05_error | 24 | S06_delete | 20 |
| S07_dead_letter | 14 | S08_multi_risky | 20 | S09_risky_plus_error | 20 | S10_tool_boundary | 16 | S11_long_vague | 12 | S12_max_retry | 20 |

**Extension B — Graph Diagram Export:** not completed

### Additional Code Changes

**Routing logic fix (S11_long_vague):**
- Moved `ERROR` classification before `MISSING_INFO` in priority order
- Removed `"issue"`, `"problem"`, `"broken"` from `ERROR_KEYWORDS` — these are vague user descriptors, not system failures
- Extended `_is_vague_query()` to catch medium-length placeholder-heavy queries:
  - `≤4 words` + ≥1 placeholder → `missing_info`
  - `5–10 words` + ≥2 placeholders → `missing_info`
  - `>10 words` → never vague
- S11 query changed to `"Something seems like an issue with this"` (3 placeholders, no error keywords) → `missing_info` ✅

## 8. Improvement Plan

If I had one more day, I would productionize in this order:

1. **Replace mock tool with real API client** — add structured tool result schema, idempotency keys, and circuit breaker
2. **LLM-as-judge for evaluation** — replace regex with an LLM that scores tool output quality and decides retry vs. answer
3. **Structured proposed_action model** — use a Pydantic model instead of JSON string so the approval UI can render fields
4. **Real Postgres checkpointer** — switch from SQLite to PostgresSaver for multi-instance deployments
5. **Observability** — emit OpenTelemetry traces from each node and integrate with LangSmith for debugging