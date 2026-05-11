import type { ChatResponse, MetricsReport, Scenario } from './types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; version: string }>('/health'),

  getScenarios: () => request<{ scenarios: Scenario[]; total: number }>('/scenarios'),

  chat: (query: string, threadId?: string, scenarioId?: string) =>
    request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ query, thread_id: threadId, scenario_id: scenarioId }),
    }),

  runAll: () =>
    request<{ report: MetricsReport; output_path: string }>('/run-all', { method: 'POST' }),

  getMetrics: () => request<MetricsReport>('/metrics'),

  getHistory: (threadId: string) =>
    request<{ checkpoints: Record<string, unknown>[] }>(`/history/${encodeURIComponent(threadId)}`),

  getHistoryState: (threadId: string, checkpointId: string) =>
    request<Record<string, unknown>>(
      `/history/${encodeURIComponent(threadId)}/state/${encodeURIComponent(checkpointId)}`
    ),

  getGraph: () =>
    request<{ mermaid: string; ascii: string; nodes: { id: string; color: string; description: string }[]; edges: { source: string; target: string; label: string }[] }>('/graph'),
};
