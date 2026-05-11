"""Node skeletons for the LangGraph workflow.

Each function should be small, testable, and return a partial state update. Avoid mutating the
input state in place.
"""

from __future__ import annotations

from .state import AgentState, ApprovalDecision, Route, make_event


def intake_node(state: AgentState) -> dict:
    """Normalize raw query into state fields.

    Performs:
    - Query normalization (strip whitespace, collapse inner whitespace)
    - PII detection (flags emails, phone numbers, SSNs in the query)
    - Metadata extraction (word count, presence of question marks, urgency signals)
    """
    import re

    query: str = (state.get("query") or "").strip()
    # Normalize inner whitespace: collapse multiple spaces/newlines into single space
    normalized_query = re.sub(r"\s+", " ", query)

    events: list[dict] = []
    pii_flags: dict[str, bool] = {}

    # Email pattern
    email_pattern = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
    pii_flags["has_email"] = bool(email_pattern.search(normalized_query))

    # Phone number pattern (various common formats)
    phone_pattern = re.compile(
        r"(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}"
    )
    pii_flags["has_phone"] = bool(phone_pattern.search(normalized_query))

    # SSN pattern (xxx-xx-xxxx)
    ssn_pattern = re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b")
    pii_flags["has_ssn"] = bool(ssn_pattern.search(normalized_query))

    # Order ID / reference number patterns
    order_pattern = re.compile(r"\b(order|id|ref|ticket)[-:\s#]*\d+\b", re.IGNORECASE)
    pii_flags["has_order_ref"] = bool(order_pattern.search(normalized_query))

    # Urgency signals
    urgency_keywords = {"urgent", "asap", "immediately", "critical", "emergency", "right now", "now"}
    words = set(normalized_query.lower().split())
    pii_flags["has_urgency"] = bool(words & urgency_keywords)

    # Word count
    word_count = len(normalized_query.split())

    # Is a question?
    is_question = "?" in normalized_query

    if any(pii_flags.values()):
        events.append(
            make_event(
                "intake",
                "pii_detected",
                f"PII flags: {[k for k, v in pii_flags.items() if v]}",
                **pii_flags,
            )
        )

    events.append(
        make_event(
            "intake",
            "completed",
            "query normalized",
            word_count=word_count,
            is_question=is_question,
            **pii_flags,
        )
    )

    return {
        "query": normalized_query,
        "messages": [f"intake:{normalized_query[:80]}"],
        "events": events,
    }


def _normalize_words(text: str) -> list[str]:
    """Strip punctuation and split text into lowercase words."""
    import string
    translator = str.maketrans("", "", string.punctuation)
    return text.translate(translator).lower().split()


def _contains_keywords(text: str, keywords: set[str]) -> bool:
    """Check if any keyword appears as a whole word in the text."""
    words = _normalize_words(text)
    return any(word in keywords for word in words)


# Keyword sets — keep priorities in sync with the routing order below
#
# RISKY: destructive/irreversible actions.
# "reset" is excluded — "reset my password" is a common benign FAQ query.
# Use "send" only when combined with money/data-sensitive context.
RISKY_KEYWORDS = {
    "refund", "delete", "cancel", "terminate", "remove",
    "suspend", "ban", "block", "disable", "close",
    "archive", "purge", "revoke", "account",
}
TOOL_KEYWORDS = {
    "status", "order", "lookup", "find", "search", "get",
    "check", "retrieve", "fetch", "show", "list", "track",
    "trace", "view", "query",
}
ERROR_KEYWORDS = {
    # Concrete system/service failures — not soft descriptors like "issue" or "broken"
    "timeout", "fail", "failure", "error", "exception", "crash",
    "down", "unavailable", "unreachable", "retry", "recover",
    "bug",  # "bug" is a software defect, not a vague placeholder
}


def classify_node(state: AgentState) -> dict:
    """Classify the query into a route using keyword priority.

    Priority order: risky > tool > error > missing_info > simple
    Punctuation is stripped before keyword matching to avoid false negatives.
    """
    query = state.get("query", "")
    normalized = query.lower()
    words = _normalize_words(query)

    # 1. Risky — destructive or irreversible actions (highest priority)
    if _contains_keywords(normalized, RISKY_KEYWORDS):
        route = Route.RISKY
        risk_level = "high"
    # 2. Tool — information retrieval that needs a backend call
    elif _contains_keywords(normalized, TOOL_KEYWORDS):
        route = Route.TOOL
        risk_level = "medium"
    # 3. Error — system/system-adjacent failures (before vague — if it has real error
    #    keywords it IS a system problem, not just a vague user description)
    elif _contains_keywords(normalized, ERROR_KEYWORDS):
        route = Route.ERROR
        risk_level = "medium"
    # 4. Missing info — too vague (few words) or placeholder-heavy
    elif _is_vague_query(words, normalized):
        route = Route.MISSING_INFO
        risk_level = "low"
    # 5. Simple — FAQ, how-to, or informational
    else:
        route = Route.SIMPLE
        risk_level = "low"

    return {
        "route": route.value,
        "risk_level": risk_level,
        "events": [make_event("classify", "completed", f"route={route.value}")],
    }


def _is_vague_query(words: list[str], normalized: str) -> bool:
    """Return True if the query is too short, vague, or placeholder-heavy.

    Strategy by query length:
    - ≤4 words  : any single placeholder → vague
    - 5–10 words: at least 2 placeholders → vague (catches things like "This X is wrong")
    -  >10 words: never vague (genuinely long query, not a placeholder)
    """
    vague_placeholders = {"it", "this", "that", "something", "issue", "problem", "broken"}
    placeholder_count = sum(1 for w in words if w in vague_placeholders)
    word_count = len(words)

    if placeholder_count == 0:
        return False

    if word_count <= 4:
        return True
    elif word_count <= 10 and placeholder_count >= 2:
        return True

    return False


def ask_clarification_node(state: AgentState) -> dict:
    """Ask for missing information instead of hallucinating.

    Generates a context-aware clarification question based on:
    - Whether the query is too short or vague
    - The presence of placeholders ("it", "this", etc.)
    - Keywords in the query that hint at what's missing
    """
    import re

    query = state.get("query", "")
    normalized = query.lower()
    words = _normalize_words(query)

    # Detect what specifically is missing based on query content
    missing_phrases: list[str] = []

    # If no order/reference number mentioned
    if not re.search(r"\b(order|id|ref|ticket|account)\b", normalized):
        missing_phrases.append("the relevant order ID, account number, or reference")

    # If vague placeholders are present
    if any(w in words for w in {"it", "this", "that", "something"}):
        missing_phrases.append("a specific description of the issue")

    # If no question mark (not clearly a question)
    if "?" not in query:
        missing_phrases.append("a clear question")

    if missing_phrases:
        question = f"Can you provide {', '.join(missing_phrases)}?"
    else:
        question = "Can you provide more details so I can assist you accurately?"

    return {
        "pending_question": question,
        "final_answer": question,
        "events": [make_event("clarify", "completed", "missing information requested", missing_phrases=missing_phrases)],
    }


def tool_node(state: AgentState) -> dict:
    """Call a mock tool.

    Simulates transient failures for error-route scenarios to demonstrate retry loops.
    TODO(student): implement idempotent tool execution and structured tool results.
    """
    attempt = int(state.get("attempt", 0))
    if state.get("route") == Route.ERROR.value and attempt < 2:
        result = f"ERROR: transient failure attempt={attempt} scenario={state.get('scenario_id', 'unknown')}"
    else:
        result = f"mock-tool-result for scenario={state.get('scenario_id', 'unknown')}"
    return {
        "tool_results": [result],
        "events": [make_event("tool", "completed", f"tool executed attempt={attempt}")],
    }


def risky_action_node(state: AgentState) -> dict:
    """Prepare a risky action for human approval.

    Builds a structured proposed action document with:
    - Action type inferred from the query keywords
    - Supporting evidence extracted from the query
    - Risk justification with severity and reversibility assessment
    """
    import json

    query = state.get("query", "")
    risk_level = state.get("risk_level", "unknown")
    scenario_id = state.get("scenario_id", "unknown")

    # Infer action type from keywords
    action_type = _infer_action_type(query)

    # Extract evidence — words that support the action rationale
    evidence_words = [w for w in query.split() if len(w) > 3][:5]
    evidence = f"Action inferred from query keywords: {', '.join(evidence_words)}"

    # Assess reversibility and severity
    reversible_actions = {"reset", "cancel", "suspend", "block"}
    irreversible_actions = {"delete", "purge", "terminate", "ban", "remove"}
    severity = "critical" if any(kw in query.lower() for kw in irreversible_actions) else "high"

    proposed_action = {
        "scenario_id": scenario_id,
        "action_type": action_type,
        "description": query,
        "evidence": evidence,
        "risk_level": risk_level,
        "severity": severity,
        "requires_approval": True,
        "reviewer_note": "Verify customer identity and authorization before executing.",
    }

    return {
        "proposed_action": json.dumps(proposed_action),
        "events": [
            make_event(
                "risky_action",
                "pending_approval",
                f"action_type={action_type} severity={severity}",
                **proposed_action,
            )
        ],
    }


def _infer_action_type(query: str) -> str:
    """Infer the action type from query keywords."""
    query_lower = query.lower()
    if "refund" in query_lower:
        return "customer_refund"
    if "delete" in query_lower:
        return "account_deletion"
    if "send" in query_lower or "email" in query_lower:
        return "email_dispatch"
    if "cancel" in query_lower:
        return "service_cancellation"
    if "reset" in query_lower:
        return "password_reset"
    if "suspend" in query_lower or "ban" in query_lower:
        return "account_suspension"
    if "close" in query_lower or "terminate" in query_lower:
        return "account_closure"
    if "account" in query_lower:
        return "account_management"
    return "generic_risky_action"


def approval_node(state: AgentState) -> dict:
    """Human approval step with optional LangGraph interrupt().

    Set LANGGRAPH_INTERRUPT=true to use real interrupt() for HITL demos.
    Default uses mock decision so tests and CI run offline.

    Supports three outcomes:
    - approved: proceed with the proposed action
    - rejected: escalate to clarification with a rejection reason
    - edited:  return a modified action for re-approval (future extension)
    Timeout is simulated via LANGGRAPH_APPROVAL_TIMEOUT_SECONDS env var.
    """
    import json
    import os

    proposed_action = state.get("proposed_action", "")
    risk_level = state.get("risk_level", "unknown")
    scenario_id = state.get("scenario_id", "unknown")
    timeout_seconds = int(os.getenv("LANGGRAPH_APPROVAL_TIMEOUT_SECONDS", "0"))

    if os.getenv("LANGGRAPH_INTERRUPT", "").lower() == "true":
        from langgraph.types import interrupt

        value = interrupt({
            "proposed_action": proposed_action,
            "risk_level": risk_level,
            "scenario_id": scenario_id,
        })
        if isinstance(value, dict):
            decision = ApprovalDecision(**value)
        else:
            decision = ApprovalDecision(approved=bool(value))
    else:
        # Parse proposed_action for structured decisions
        try:
            action_data = json.loads(proposed_action)
            action_type = action_data.get("action_type", "unknown")
            severity = action_data.get("severity", "high")
        except (TypeError, json.JSONDecodeError):
            action_type = "generic"
            severity = "high"

        # Simulate timeout: if timeout > 0 and time exceeded, auto-escalate
        if timeout_seconds > 0:
            decision = ApprovalDecision(
                approved=False,
                comment=f"TIMEOUT: no response within {timeout_seconds}s — escalated to on-call",
            )
        else:
            # Mock approval with context-aware comment
            decision = ApprovalDecision(
                approved=True,
                comment=f"mock approval for lab — action_type={action_type} severity={severity}",
            )

    # Emit event with decision metadata
    event_type = "approved" if decision.approved else "rejected"
    return {
        "approval": decision.model_dump(),
        "events": [
            make_event(
                "approval",
                event_type,
                f"decision={event_type} reviewer={decision.reviewer}",
                timeout_seconds=timeout_seconds,
            )
        ],
    }


def retry_or_fallback_node(state: AgentState) -> dict:
    """Record a retry attempt with bounded retry logic and exponential backoff metadata.

    Bounded retry: stops and routes to dead_letter once attempt >= max_attempts.
    Exponential backoff: delay_ms doubles with each attempt (capped at 60s).
    Fallback metadata is attached so downstream nodes or observability can act on it.
    """
    attempt = int(state.get("attempt", 0)) + 1
    max_attempts = int(state.get("max_attempts", 3))
    scenario_id = state.get("scenario_id", "unknown")

    # Exponential backoff: base 1s, doubles each retry, capped at 60s
    backoff_delay_ms = min(1_000 * (2 ** (attempt - 1)), 60_000)

    errors = [f"transient failure attempt={attempt}"]
    return {
        "attempt": attempt,
        "errors": errors,
        "events": [
            make_event(
                "retry",
                "completed",
                f"retry attempt recorded attempt={attempt}/{max_attempts}",
                attempt=attempt,
                max_attempts=max_attempts,
                backoff_delay_ms=backoff_delay_ms,
                scenario_id=scenario_id,
            )
        ],
    }


def answer_node(state: AgentState) -> dict:
    """Produce a final response.

    TODO(student): ground the answer in tool_results and approval where relevant.
    """
    if state.get("tool_results"):
        answer = f"I found: {state['tool_results'][-1]}"
    else:
        answer = "This is a safe mock answer. Replace with your agent response."
    return {
        "final_answer": answer,
        "events": [make_event("answer", "completed", "answer generated")],
    }


def evaluate_node(state: AgentState) -> dict:
    """Evaluate tool results — the 'done?' check that enables retry loops.

    Detects failure patterns in tool results using multiple strategies:
    1. Explicit ERROR markers
    2. HTTP error codes (4xx/5xx)
    3. Common exception/error keywords
    4. Transient failure signals (timeout, unavailable, retry)
    """
    import re

    tool_results: list[str] = state.get("tool_results", [])
    latest = tool_results[-1] if tool_results else ""

    failure_patterns = [
        r"\bERROR\b",
        r"\bFAILED\b",
        r"\bFAILURE\b",
        r"HTTP [45]\d\d",
        r"\btimeout\b",
        r"\btimeout\b".capitalize(),
        r"\bTraceback\b",
        r"\bException\b",
        r"\bunavailable\b",
        r"\bretry\b",
        r"\bcannot recover\b",
        r"\bconnection refused\b",
    ]
    for pattern in failure_patterns:
        if re.search(pattern, latest, re.IGNORECASE):
            return {
                "evaluation_result": "needs_retry",
                "events": [
                    make_event(
                        "evaluate",
                        "completed",
                        f"tool result indicates failure, retry needed (matched: {pattern})",
                    )
                ],
            }

    return {
        "evaluation_result": "success",
        "events": [make_event("evaluate", "completed", "tool result satisfactory")],
    }


def dead_letter_node(state: AgentState) -> dict:
    """Log unresolvable failures for manual review.

    Persists the failure context to a structured dead-letter record:
    - Scenario metadata for the on-call engineer
    - Retry history and final error
    - Escalation priority based on attempt count and route
    """
    import json
    from datetime import datetime, timezone

    scenario_id = state.get("scenario_id", "unknown")
    attempt = int(state.get("attempt", 0))
    max_attempts = int(state.get("max_attempts", 3))
    route = state.get("route", "unknown")
    query = state.get("query", "")
    errors: list[str] = list(state.get("errors") or [])

    # Escalation priority: higher if it hit max_attempts or if risky route failed
    priority = "P2"
    if attempt >= max_attempts and attempt > 2:
        priority = "P1"
    if route == Route.RISKY.value:
        priority = "P1"

    dead_letter_record = {
        "scenario_id": scenario_id,
        "query": query,
        "route": route,
        "attempt": attempt,
        "max_attempts": max_attempts,
        "priority": priority,
        "errors": errors,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
        "assigned_to": None,
    }

    return {
        "final_answer": (
            f"Request could not be completed after {attempt} attempt(s). "
            f"This has been logged for manual review (priority: {priority})."
        ),
        "events": [
            make_event(
                "dead_letter",
                "completed",
                f"max retries exceeded attempt={attempt}/{max_attempts} priority={priority}",
                **dead_letter_record,
            )
        ],
    }


def finalize_node(state: AgentState) -> dict:
    """Finalize the run and emit a final audit event."""
    return {"events": [make_event("finalize", "completed", "workflow finished")]}
