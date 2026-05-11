import { useState, useEffect } from 'react';
import { Play, CheckCircle2, XCircle, Loader2, ChevronRight, RotateCcw } from 'lucide-react';
import { api } from '../api';
import type { Scenario, ScenarioMetric } from '../types';

function RouteBadge({ route }: { route: string }) {
  const map: Record<string, string> = {
    simple: 'badge-route-simple',
    tool: 'badge-route-tool',
    risky: 'badge-route-risky',
    error: 'badge-route-error',
    missing_info: 'badge-route-missing',
    dead_letter: 'badge-fail',
  };
  return <span className={`badge ${map[route] || 'bg-gray-500/20 text-gray-400'}`}>{route}</span>;
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [metrics, setMetrics] = useState<ScenarioMetric[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getScenarios().then(r => setScenarios(r.scenarios)).catch(() => {});
  }, []);

  async function runAll() {
    setRunning(true);
    setProgress(0);
    setMetrics([]);
    setError(null);
    try {
      const result = await api.runAll();
      setMetrics(result.report.scenario_metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
      setProgress(100);
    }
  }

  function getMetric(scenarioId: string): ScenarioMetric | undefined {
    return metrics.find(m => m.scenario_id === scenarioId);
  }

  return (
    <div className="px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Scenarios</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">{scenarios.length} test scenarios available</p>
        </div>
        <button
          onClick={runAll}
          disabled={running || scenarios.length === 0}
          className="btn-primary flex items-center gap-2"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? `Running... ${progress}%` : 'Run All Scenarios'}
        </button>
      </div>

      {/* Progress bar */}
      {running && (
        <div className="mb-6">
          <div className="h-1.5 bg-[var(--surface)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Summary cards */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total', value: metrics.length, color: 'var(--accent)' },
            { label: 'Passed', value: metrics.filter(m => m.success).length, color: 'var(--success)' },
            { label: 'Failed', value: metrics.filter(m => !m.success).length, color: 'var(--danger)' },
            {
              label: 'Success Rate',
              value: `${Math.round((metrics.filter(m => m.success).length / metrics.length) * 100)}%`,
              color: 'var(--warning',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="card">
              <div className="text-xs text-[var(--muted)] mb-1">{label}</div>
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Scenario list */}
      <div className="space-y-3">
        {scenarios.map((scenario, idx) => {
          const metric = getMetric(scenario.id);
          const isExpanded = expanded === scenario.id;

          return (
            <div key={scenario.id} className="card">
              {/* Row header */}
              <button
                className="w-full flex items-center gap-3 text-left"
                onClick={() => setExpanded(isExpanded ? null : scenario.id)}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  metric?.success === true
                    ? 'bg-green-500/20 text-green-400'
                    : metric?.success === false
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-[var(--bg)] text-[var(--muted)] border border-[var(--border)]'
                }`}>
                  {idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{scenario.query}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <RouteBadge route={scenario.expected_route} />
                    {scenario.requires_approval && (
                      <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">needs approval</span>
                    )}
                    {scenario.should_retry && (
                      <span className="badge bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">should retry</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {metric && (
                    metric.success
                      ? <CheckCircle2 size={16} className="text-green-400" />
                      : <XCircle size={16} className="text-red-400" />
                  )}
                  <ChevronRight size={14} className={`text-[var(--muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && metric && (
                <div className="mt-4 pt-4 border-t border-[var(--border)] grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-[var(--muted)] mb-1">Actual Route</div>
                    <RouteBadge route={metric.actual_route || ''} />
                  </div>
                  <div>
                    <div className="text-[var(--muted)] mb-1">Nodes Visited</div>
                    <div className="text-[var(--text)]">{metric.nodes_visited}</div>
                  </div>
                  <div>
                    <div className="text-[var(--muted)] mb-1">Retry Count</div>
                    <div className="text-[var(--text)]">{metric.retry_count}</div>
                  </div>
                  <div>
                    <div className="text-[var(--muted)] mb-1">Latency</div>
                    <div className="text-[var(--text)]">{metric.latency_ms}ms</div>
                  </div>
                  <div>
                    <div className="text-[var(--muted)] mb-1">Approval Observed</div>
                    <div className={metric.approval_observed ? 'text-green-400' : 'text-[var(--muted)]'}>
                      {metric.approval_observed ? 'Yes' : 'No'}
                    </div>
                  </div>
                  {metric.errors.length > 0 && (
                    <div className="col-span-3">
                      <div className="text-[var(--muted)] mb-1">Errors</div>
                      {metric.errors.map((e, i) => (
                        <div key={i} className="text-red-400 mt-1">• {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
