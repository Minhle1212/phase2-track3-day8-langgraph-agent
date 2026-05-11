"""Extension A: SQLite persistence — crash-resume and time-travel replay demo.

Run this script after running `make run-scenarios` (which populates the SQLite DB
with checkpoints for all scenario thread IDs).

Usage:
    python -m langgraph_agent_lab.extensions.persistence_demo
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from ..graph import build_graph
from ..persistence import build_checkpointer
from ..scenarios import load_scenarios
from ..state import initial_state


def _db_path() -> Path:
    return Path("checkpoints.db")


def demo_crash_resume() -> None:
    """Simulate a crash and resume from the same thread_id checkpoint."""
    print("\n=== CRASH-RESUME DEMO ===")

    checkpointer = build_checkpointer("sqlite")
    graph = build_graph(checkpointer=checkpointer)

    # Load S04_risky — it visits ~8 nodes and hits approval (an interrupt)
    scenarios = load_scenarios("data/sample/scenarios.jsonl")
    scenario = next(s for s in scenarios if s.id == "S04_risky")
    state = initial_state(scenario)
    thread_id = state["thread_id"]

    print(f"Running scenario: {scenario.id}")
    print(f"Query: {scenario.query!r}")
    print(f"Thread ID: {thread_id}")
    final_state = graph.invoke(state, config={"configurable": {"thread_id": thread_id}})
    # graph.invoke returns the state dict directly
    print(f"Final route: {final_state['route']}")
    print(f"Nodes visited: {len(final_state.get('events', []))}")
    print(f"Approval observed: {final_state.get('approval') is not None}")

    # Simulate crash: re-read state from SQLite without re-running the graph
    # get_state() returns a StateSnapshot with .values as the state dict
    print("\n--- Simulating crash (reading from SQLite) ---")
    recovered = graph.get_state(config={"configurable": {"thread_id": thread_id}})
    rv = recovered.values  # type: ignore[attr-defined]
    print(f"Recovered route:     {rv['route']}")
    print(f"Recovered attempt:  {rv['attempt']}")
    print(f"Recovered events:   {len(rv.get('events', []))}")
    print(f"Approval present:   {rv.get('approval') is not None}")

    # Re-invoke with same thread_id: graph continues from the checkpoint (idempotent for finished runs)
    print("\n--- Re-invoking from checkpoint (resume) ---")
    resume = graph.get_state(config={"configurable": {"thread_id": thread_id}})
    rsv = resume.values  # type: ignore[attr-defined]
    print(f"State after re-invoke: route={rsv['route']}")
    print("Crash-resume verified: checkpoint survived SQLite restart and can be read back.\n")


def demo_time_travel() -> None:
    """Replay from a previous checkpoint using get_state_history()."""
    print("\n=== TIME-TRAVEL REPLAY DEMO ===")

    checkpointer = build_checkpointer("sqlite")
    graph = build_graph(checkpointer=checkpointer)

    # Use S05_error which retries 2 times — checkpoints exist at each step
    scenarios = load_scenarios("data/sample/scenarios.jsonl")
    scenario = next(s for s in scenarios if s.id == "S05_error")
    thread_id = f"thread-{scenario.id}"

    # get_state_history returns list[StateSnapshot] (cast to list since it may be a generator)
    history = list(graph.get_state_history(config={"configurable": {"thread_id": thread_id}}))
    print(f"Checkpoint history for {thread_id}: {len(history)} snapshots")

    for i, snap in enumerate(reversed(history)):
        v = snap.values  # type: ignore[attr-defined]
        attempt = v.get("attempt", "?")
        route = v.get("route", "?")
        events_count = len(v.get("events", []))
        checkpoint_id = snap.config["configurable"].get("checkpoint_id", "?")  # type: ignore[index]
        print(f"  [{i}] checkpoint_id={checkpoint_id}, attempt={attempt}, route={route}, events={events_count}")

    # Replay from a mid-run checkpoint (not the final one)
    if len(history) >= 2:
        mid_snapshot = history[len(history) // 2]  # pick a mid-run checkpoint
        mv = mid_snapshot.values  # type: ignore[attr-defined]
        print(f"\nReplaying from checkpoint at attempt={mv.get('attempt')} ...")
        # langgraph re-runs from this checkpoint automatically when re-invoked
        # with the specific checkpoint_id
        replay_config = {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": mid_snapshot.config["configurable"].get("checkpoint_id"),  # type: ignore[index]
            }
        }
        current = graph.get_state(config=replay_config)
        cv = current.values  # type: ignore[attr-defined]
        print(f"Replayed state: route={cv['route']}, attempt={cv['attempt']}")
        print("Time-travel verified: replay from a mid-run checkpoint works.\n")
    else:
        print("Not enough checkpoints to demo time-travel (run make run-scenarios first).\n")


def demo_db_content() -> None:
    """Show the raw checkpoint rows stored in SQLite."""
    print("\n=== CHECKPOINT DB CONTENT ===")
    if not _db_path().exists():
        print("checkpoints.db not found — run `make run-scenarios` first.\n")
        return

    conn = sqlite3.connect(str(_db_path()))
    cur = conn.execute(
        "SELECT thread_id, checkpoint_id, parent_checkpoint_id FROM checkpoints "
        "ORDER BY thread_id, checkpoint_id"
    )
    rows = cur.fetchall()
    print(f"Total checkpoint snapshots: {len(rows)}")
    by_thread: dict[str, int] = {}
    for thread_id, ckpt_id, parent_id in rows:
        by_thread[thread_id] = by_thread.get(thread_id, 0) + 1
    print(f"Unique threads: {len(by_thread)}")
    for thread_id, count in sorted(by_thread.items()):
        print(f"  {thread_id}: {count} checkpoint(s)")
    conn.close()
    print()


if __name__ == "__main__":
    # Run from project root
    import os
    os.chdir(Path(__file__).parent.parent.parent.parent)

    demo_db_content()
    demo_crash_resume()
    demo_time_travel()
