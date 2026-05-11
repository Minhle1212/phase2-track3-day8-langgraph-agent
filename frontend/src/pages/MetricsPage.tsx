import { useState, useEffect } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { MetricsReport, ScenarioMetric } from '../types';

function MetricCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="stat-card animate-fade-in-up">
      <div className="text-xs text-[var(--muted)] mb-1">{label}</div>
      <div className="text-3xl font-bold" style={{ color: color || 'var(--text)' }}>{value}</div>
      {sub && <div className="text-xs text-[var(--muted)] mt-1">{sub}</div>}
    </div>
  );
}

function ScenarioRow({ metric }: { metric: ScenarioMetric }) {
  const routeColor: Record<string, string> = {
    simple: 'badge-route-simple',
    tool: 'badge-route-tool',
    risky: 'badge-route-risky',
    error: 'badge-route-error',
    missing_info: 'badge-route-missing',
    dead_letter: 'badge-fail',
  };

  return (
    <tr className={`${metric.success ? 'success-row' : 'fail-row'}`}>
      <td className="py-3 px-3">
        <div className={`w-2 h-2 rounded-full ${metric.success ? 'bg-green-400' : 'bg-red-400'}`} />
      </td>
      <td className="py-3 px-3 text-sm font-mono">{metric.scenario_id}</td>
      <td className="py-3 px-3">
        <span className={`badge ${routeColor[metric.expected_route] || 'bg-gray-500/20 text-gray-400'}`}>
          {metric.expected_route}
        </span>
      </td>
      <td className="py-3 px-3">
        <span className={`badge ${routeColor[metric.actual_route || ''] || 'bg-gray-500/20 text-gray-400'}`}>
          {metric.actual_route || '—'}
        </span>
      </td>
      <td className="py-3 px-3 text-sm text-[var(--muted)]">{metric.nodes_visited}</td>
      <td className="py-3 px-3 text-sm text-[var(--muted)]">{metric.retry_count}</td>
      <td className="py-3 px-3 text-sm text-[var(--muted)]">{metric.latency_ms}ms</td>
      <td className="py-3 px-3">
        {metric.approval_observed
          ? <span className="text-xs text-purple-400 font-medium">Yes</span>
          : <span className="text-xs text-[var(--muted)]">—</span>
        }
      </td>
      <td className="py-3 px-3">
        {metric.success
          ? <span className="text-xs text-green-400 font-bold">PASS</span>
          : <span className="text-xs text-red-400 font-bold">FAIL</span>
        }
      </td>
    </tr>
  );
}

export default function MetricsPage() {
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMetrics();
      setReport(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const successRate = report ? Math.round(report.success_rate * 100) : 0;
  const barColor = successRate >= 90 ? 'var(--success)' : successRate >= 70 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="px-8 py-6 page-wrapper">
      <div className="page-content">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold page-header">Metrics</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">Performance summary from the last scenario run</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm text-red-400 animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
          {error}
          {!report && <button onClick={load} className="ml-3 underline">Retry</button>}
        </div>
      )}

      {!report && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-3 animate-fade-in-up">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2" style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.15)' }}>
            <BarChart3 size={28} className="text-[var(--accent)]" />
          </div>
          <div>
            <p className="text-[var(--text)] font-medium">No metrics available</p>
            <p className="text-sm text-[var(--muted)] mt-1">
              Run the scenarios from the <span className="gradient-text font-medium">Scenarios</span> page first.
            </p>
          </div>
        </div>
      )}

      {report && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6 stagger-list">
            <MetricCard label="Total Scenarios" value={report.total_scenarios} />
            <MetricCard label="Success Rate" value={`${successRate}%`} color={barColor} />
            <MetricCard label="Avg Nodes Visited" value={report.avg_nodes_visited.toFixed(1)} sub="per scenario" />
            <MetricCard label="Total Retries" value={report.total_retries} sub={`${report.total_interrupts} interrupts`} />
          </div>

          {/* Success rate bar */}
          <div className="card mb-6 animate-fade-in-up">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Success Rate</span>
              <span className="text-sm font-bold" style={{ color: barColor }}>{successRate}%</span>
            </div>
            <div className="h-3 bg-[var(--bg)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${successRate}%`, backgroundColor: barColor }}
              />
            </div>
          </div>

          {/* Per-scenario table */}
          <div className="card p-0 overflow-hidden animate-fade-in-up">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-semibold">Per-Scenario Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full metrics-table">
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="py-2.5 px-3 text-left w-8">#</th>
                    <th className="py-2.5 px-3 text-left">Scenario</th>
                    <th className="py-2.5 px-3 text-left">Expected</th>
                    <th className="py-2.5 px-3 text-left">Actual</th>
                    <th className="py-2.5 px-3 text-left">Nodes</th>
                    <th className="py-2.5 px-3 text-left">Retries</th>
                    <th className="py-2.5 px-3 text-left">Latency</th>
                    <th className="py-2.5 px-3 text-left">Approval</th>
                    <th className="py-2.5 px-3 text-left">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.scenario_metrics.map((metric) => (
                    <ScenarioRow key={metric.scenario_id} metric={metric} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {lastRefresh && (
            <p className="text-xs text-[var(--muted)] mt-4 text-right">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </p>
          )}
        </>
      )}
    </div>
    </div>
  );
}
