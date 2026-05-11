// Shared types mirroring the FastAPI backend

export type RouteType = 'simple' | 'tool' | 'missing_info' | 'risky' | 'error' | 'dead_letter' | 'done' | '';

export interface LabEvent {
  node: string;
  event_type: string;
  message: string;
  latency_ms: number;
  metadata: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  query: string;
  expected_route: RouteType;
  requires_approval: boolean;
  should_retry: boolean;
  max_attempts: number;
  tags: string[];
}

export interface ChatResponse {
  thread_id: string;
  final_answer: string | null;
  route: string;
  risk_level: string;
  attempt: number;
  nodes_visited: string[];
  tool_results: string[];
  errors: string[];
  events: LabEvent[];
  pending_question: string | null;
  proposed_action: string | null;
  approval: Record<string, unknown> | null;
}

export interface ScenarioMetric {
  scenario_id: string;
  success: boolean;
  expected_route: string;
  actual_route: string | null;
  nodes_visited: number;
  retry_count: number;
  approval_required: boolean;
  approval_observed: boolean;
  latency_ms: number;
  errors: string[];
}

export interface MetricsReport {
  total_scenarios: number;
  success_rate: number;
  avg_nodes_visited: number;
  total_retries: number;
  total_interrupts: number;
  resume_success: boolean;
  scenario_metrics: ScenarioMetric[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thread_id?: string;
  route?: string;
  risk_level?: string;
  nodes_visited?: string[];
  tool_results?: string[];
  errors?: string[];
  events?: LabEvent[];
  pending_question?: string | null;
  proposed_action?: string | null;
  approval?: Record<string, unknown> | null;
  timestamp: Date;
}
