import { useState } from 'react';
import { History, Search, Loader2, ChevronRight, Clock, GitBranch } from 'lucide-react';
import { api } from '../api';

interface CheckpointEntry {
  checkpoint_id: string | null;
  metadata: Record<string, unknown>;
  parent_checkpoint_id?: string;
}

export default function HistoryPage() {
  const [threadId, setThreadId] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(null);
  const [checkpointState, setCheckpointState] = useState<Record<string, unknown> | null>(null);
  const [loadingState, setLoadingState] = useState(false);

  async function loadHistory() {
    if (!threadId.trim()) return;
    setLoading(true);
    setError(null);
    setCheckpoints([]);
    setSelectedCheckpoint(null);
    setCheckpointState(null);
    try {
      const data = await api.getHistory(threadId.trim());
      setCheckpoints(data.checkpoints as unknown as CheckpointEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }

  async function loadCheckpointState(checkpointId: string) {
    if (!checkpointId) return;
    setSelectedCheckpoint(checkpointId);
    setLoadingState(true);
    try {
      const state = await api.getHistoryState(threadId.trim(), checkpointId);
      setCheckpointState(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load checkpoint state');
    } finally {
      setLoadingState(false);
    }
  }

  return (
    <div className="px-8 py-6 page-wrapper">
      <div className="page-content">
      <div className="mb-6">
        <h1 className="text-xl font-semibold page-header flex items-center gap-2">
          <History size={20} />
          Checkpoint History
        </h1>
        <p className="text-sm text-[var(--muted)] mt-0.5">
          Browse and replay checkpoints from the SQLite persistence layer
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
          <input
            type="text"
            value={threadId}
            onChange={e => setThreadId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadHistory()}
            placeholder="Enter thread ID (e.g. thread-scenario-01)"
            className="input pl-10"
          />
        </div>
        <button onClick={loadHistory} disabled={loading || !threadId.trim()} className="btn-primary">
          {loading ? <Loader2 size={15} className="animate-spin" /> : 'Load'}
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm text-red-400 animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-5 stagger-list">
        {/* Checkpoint list */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-[var(--muted)]" />
            <span className="text-sm font-medium">Checkpoints</span>
            {checkpoints.length > 0 && (
              <span className="ml-auto badge" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-bright)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>{checkpoints.length}</span>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8 text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin mr-2" />
              <span className="text-sm">Loading...</span>
            </div>
          )}

          {!loading && checkpoints.length === 0 && !error && (
            <div className="text-center py-8 text-sm text-[var(--muted)]">
              Enter a thread ID and click Load
            </div>
          )}

          {!loading && checkpoints.length > 0 && (
            <div className="space-y-1">
              {checkpoints.map((cp, idx) => (
                <button
                  key={cp.checkpoint_id || idx}
                  onClick={() => cp.checkpoint_id && loadCheckpointState(cp.checkpoint_id)}
                  disabled={!cp.checkpoint_id}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all text-sm ${
                    selectedCheckpoint === cp.checkpoint_id
                      ? 'active'
                      : 'nav-item'
                  } ${!cp.checkpoint_id ? 'opacity-40 cursor-default' : ''}`}
                >
                  <GitBranch size={12} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">
                      {cp.checkpoint_id ? cp.checkpoint_id.slice(0, 16) + '...' : '—'}
                    </div>
                    {cp.metadata && Object.keys(cp.metadata).length > 0 && (
                      <div className="text-xs text-[var(--muted)] mt-0.5 truncate">
                        {Object.keys(cp.metadata).join(', ')}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={12} className="flex-shrink-0 opacity-50" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* State viewer */}
        <div className="col-span-2 card">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch size={14} className="text-[var(--muted)]" />
            <span className="text-sm font-medium">State at Checkpoint</span>
          </div>

          {!selectedCheckpoint && !loadingState && (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.1)' }}>
                <GitBranch size={22} className="text-[var(--muted)]" />
              </div>
              <p className="text-sm text-[var(--muted)]">Select a checkpoint to view its state</p>
            </div>
          )}

          {loadingState && (
            <div className="flex items-center justify-center py-16 text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin mr-2" />
              <span className="text-sm">Loading state...</span>
            </div>
          )}

          {checkpointState && !loadingState && (
            <pre className="text-xs animate-scale-in" style={{ background: 'var(--bg)', borderRadius: '12px', padding: '16px', overflow: 'auto', maxHeight: '500px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", lineHeight: '1.7', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              {JSON.stringify(checkpointState, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
