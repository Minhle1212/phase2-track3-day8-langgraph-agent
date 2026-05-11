import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, ChevronRight, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ChatMessage } from '../types';

interface Scenario {
  id: string;
  query: string;
  expected_route: string;
  requires_approval: boolean;
  should_retry: boolean;
  max_attempts?: number;
  tags: string[];
}

const SCENARIOS: Scenario[] = [
  { id: 'S01', query: 'How do I reset my password?', expected_route: 'simple', requires_approval: false, should_retry: false, tags: ['simple'] },
  { id: 'S02', query: 'Please lookup order status for order 12345', expected_route: 'tool', requires_approval: false, should_retry: false, tags: ['tool'] },
  { id: 'S03', query: 'Can you fix it?', expected_route: 'missing_info', requires_approval: false, should_retry: false, tags: ['clarification'] },
  { id: 'S04', query: 'Refund this customer and send confirmation email', expected_route: 'risky', requires_approval: true, should_retry: false, tags: ['hitl', 'risky'] },
  { id: 'S05', query: 'Timeout failure while processing request', expected_route: 'error', requires_approval: false, should_retry: true, tags: ['retry'] },
  { id: 'S06', query: 'Delete customer account after support verification', expected_route: 'risky', requires_approval: true, should_retry: false, tags: ['hitl', 'destructive'] },
  { id: 'S07', query: 'System failure cannot recover after multiple attempts', expected_route: 'error', requires_approval: false, should_retry: true, max_attempts: 1, tags: ['dead_letter', 'retry'] },
  { id: 'S08', query: 'Cancel terminate and delete this customer account immediately', expected_route: 'risky', requires_approval: true, should_retry: false, tags: ['risky', 'multi-keyword'] },
  { id: 'S09', query: 'Refund the transaction because the payment failed', expected_route: 'risky', requires_approval: true, should_retry: false, tags: ['risky', 'ambiguous'] },
  { id: 'S10', query: 'Check it', expected_route: 'tool', requires_approval: false, should_retry: false, tags: ['tool', 'boundary'] },
  { id: 'S11', query: 'Something seems like an issue with this', expected_route: 'missing_info', requires_approval: false, should_retry: false, tags: ['missing_info', 'vague'] },
  { id: 'S12', query: 'Server unavailable causing timeout errors repeatedly', expected_route: 'error', requires_approval: false, should_retry: true, max_attempts: 2, tags: ['retry'] },
];

const ROUTE_LABELS: Record<string, string> = {
  simple: 'badge-route-simple',
  tool: 'badge-route-tool',
  missing_info: 'badge-route-missing',
  risky: 'badge-route-risky',
  error: 'badge-route-error',
  dead_letter: 'badge-fail',
};

const ANSWERS: Record<string, { answer: string; nodes: string[]; tools?: string[] }> = {
  simple: {
    answer: 'You can reset your password by visiting the account settings page and clicking "Forgot Password". A reset link will be sent to your email.',
    nodes: ['intake', 'classify', 'answer', 'finalize'],
  },
  tool: {
    answer: 'Order #12345 is currently in "shipped" status. Estimated delivery: 2–3 business days. Tracking number: TRK-99887766.',
    nodes: ['intake', 'classify', 'tool', 'evaluate', 'answer', 'finalize'],
    tools: ['lookup_order_status'],
  },
  missing_info: {
    answer: 'I\'d be happy to help! Could you provide more details about what you\'d like me to fix? Please include any relevant order numbers or account information.',
    nodes: ['intake', 'classify', 'clarify', 'finalize'],
  },
  risky: {
    answer: 'This action requires manager approval. I\'ve submitted the request for review. You\'ll be notified once it\'s approved and processed.',
    nodes: ['intake', 'classify', 'risky_action', 'approval', 'tool', 'evaluate', 'answer', 'finalize'],
    tools: ['execute_refund', 'send_email'],
  },
  error: {
    answer: 'The system encountered a timeout while processing your request. The operation has been retried automatically. Please try again in a few moments.',
    nodes: ['intake', 'classify', 'tool', 'evaluate', 'retry', 'tool', 'answer', 'finalize'],
    tools: ['process_request'],
  },
};

function simulateResponse(query: string): ChatMessage {
  const scenario = SCENARIOS.find(s => s.query === query);
  const route = scenario?.expected_route || 'simple';
  const data = ANSWERS[route] || ANSWERS.simple;
  const events = data.nodes.map((node) => ({
    node,
    event_type: 'node_completed',
    message: `${node.replace('_', ' ')} completed`,
    latency_ms: Math.floor(Math.random() * 80) + 20,
    metadata: {},
  }));
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: data.answer,
    route,
    risk_level: scenario?.requires_approval ? 'high' : 'low',
    nodes_visited: data.nodes,
    tool_results: data.tools || [],
    errors: [],
    events,
    timestamp: new Date(),
  };
}

function routeBadge(route: string) {
  const map: Record<string, string> = {
    simple: 'badge-route-simple',
    tool: 'badge-route-tool',
    risky: 'badge-route-risky',
    error: 'badge-route-error',
    missing_info: 'badge-route-missing',
    dead_letter: 'badge-fail',
  };
  return map[route] || 'bg-gray-500/20 text-gray-400 border border-gray-500/30';
}

function EventTimeline({ events }: { events: ChatMessage['events'] }) {
  if (!events?.length) return null;
  return (
    <details className="mt-3">
      <summary className="text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--text)]">
        {events.length} event{events.length !== 1 ? 's' : ''} — click to expand
      </summary>
      <div className="mt-2 space-y-1.5">
        {events.map((ev, i) => (
          <div key={i} className="flex items-start gap-2.5 text-xs">
            <div className="flex-shrink-0 mt-0.5 w-4 h-4 rounded bg-[var(--accent)]/20 border border-[var(--accent)]/30 flex items-center justify-center">
              <ChevronRight size={8} className="text-[var(--accent)]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[var(--accent)]">{ev.node}</span>
                <span className="text-[var(--muted)]">{ev.event_type}</span>
                {ev.latency_ms > 0 && (
                  <span className="text-[var(--muted)] ml-auto">{ev.latency_ms}ms</span>
                )}
              </div>
              <div className="text-[var(--muted)] mt-0.5 truncate">{ev.message}</div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function ChatPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent, presetQuery?: string) {
    e.preventDefault();
    const text = presetQuery ?? query;
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    if (!presetQuery) setQuery('');
    setLoading(true);
    setError(null);

    // Simulate network delay
    await new Promise(r => setTimeout(r, 800 + Math.random() * 600));

    const assistantMsg = simulateResponse(text.trim());
    setMessages(prev => [...prev, assistantMsg]);
    setLoading(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-full page-wrapper">
      <div className="page-content flex flex-col h-full">

      {/* Header */}
      <div className="px-8 py-5 border-b border-[var(--border)]" style={{ background: 'rgba(10, 12, 20, 0.7)', backdropFilter: 'blur(12px)' }}>
        <h1 className="text-xl font-semibold page-header">Chat</h1>
        <p className="text-sm text-[var(--muted)] mt-0.5">Ask the agent anything — it routes, retries, and approves automatically.</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="space-y-6 animate-fade-in-up">
            {/* Hero */}
            <div className="flex flex-col items-center text-center space-y-3 pt-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse-glow" style={{ background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                <Bot size={24} className="text-[var(--accent)]" />
              </div>
              <div>
                <p className="text-[var(--text)] font-medium text-base">LangGraph Agent is ready</p>
                <p className="text-sm text-[var(--muted)] mt-1">Pick a scenario below or type your own query</p>
              </div>
            </div>

            {/* Scenario quick-picks */}
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)] font-medium uppercase tracking-wider text-center">Scenarios</p>
              <div className="grid grid-cols-2 gap-2 stagger-list-sm">
                {SCENARIOS.map(s => (
                  <button
                    key={s.id}
                    onClick={e => handleSend(e as unknown as React.FormEvent, s.query)}
                    className="card card-interactive text-left p-3"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-mono font-bold text-[var(--muted)]">{s.id}</span>
                      <span className={`badge ${ROUTE_LABELS[s.expected_route] || ''}`} style={{ fontSize: '10px' }}>
                        {s.expected_route}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text)] leading-relaxed line-clamp-2">{s.query}</div>
                    {s.requires_approval && (
                      <div className="text-[10px] text-purple-400 mt-1">requires approval</div>
                    )}
                    {s.should_retry && (
                      <div className="text-[10px] text-yellow-400 mt-0.5">{s.max_attempts ? `max ${s.max_attempts} retries` : 'may retry'}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 msg-container ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
              msg.role === 'user'
                ? 'text-white'
                : 'bg-[var(--surface)] border border-[var(--border)]'
            }`} style={msg.role === 'user' ? { background: 'linear-gradient(135deg, var(--accent) 0%, #4f52d9 100%)' } : {}}>
              {msg.role === 'user'
                ? <User size={14} className="text-white" />
                : <Bot size={14} className="text-[var(--muted)]" />
              }
            </div>

            <div className={`flex-1 min-w-0 max-w-2xl ${msg.role === 'user' ? 'text-right' : ''}`}>
              <div className={`inline-block ${msg.role === 'user' ? '' : 'w-full'}`}>
                <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed text-left ${
                  msg.role === 'user'
                    ? 'msg-bubble-user text-white'
                    : 'msg-bubble-assistant'
                }`}>
                  {msg.content}
                </div>

                {/* Metadata bar for assistant messages */}
                {msg.role === 'assistant' && msg.route && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`badge ${routeBadge(msg.route)}`}>{msg.route}</span>
                    {msg.risk_level && msg.risk_level !== 'unknown' && (
                      <span className={`badge ${msg.risk_level === 'high' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'}`}>
                        {msg.risk_level} risk
                      </span>
                    )}
                    {(msg.nodes_visited?.length ?? 0) > 0 && (
                      <span className="text-[var(--muted)]">{msg.nodes_visited!.length} nodes visited</span>
                    )}
                    {(msg.tool_results?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 size={11} />
                        {msg.tool_results!.length} tool call{msg.tool_results!.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {(msg.errors?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-red-400">
                        <XCircle size={11} />
                        {msg.errors!.length} error{msg.errors!.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Pending question */}
                {msg.role === 'assistant' && msg.pending_question && (
                  <div className="approval-block mt-2 text-xs text-yellow-400">
                    <AlertTriangle size={11} className="inline mr-1" />
                    Clarification needed: {msg.pending_question}
                  </div>
                )}

                {/* Proposed action for risky queries */}
                {msg.role === 'assistant' && msg.proposed_action && (
                  <div className="risky-block mt-2">
                    <div className="text-xs text-purple-400 font-medium mb-1">Proposed Action</div>
                    <pre className="text-xs text-[var(--muted)] whitespace-pre-wrap">{msg.proposed_action}</pre>
                  </div>
                )}

                <EventTimeline events={msg.events} />
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 msg-container">
            <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
              <Bot size={14} className="text-[var(--muted)]" />
            </div>
            <div className="flex items-center gap-2.5 text-sm text-[var(--muted)]">
              <div className="typing-dots">
                <span /><span /><span />
              </div>
              Agent is thinking...
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-400 animate-fade-in" style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
            <XCircle size={14} />
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-5 border-t border-[var(--border)]" style={{ background: 'rgba(10, 12, 20, 0.7)', backdropFilter: 'blur(12px)' }}>
        <form onSubmit={handleSend} className="flex gap-3 max-w-3xl">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ask the agent... (e.g. 'status of order #12345')"
            className="input flex-1"
            disabled={loading}
          />
          <button type="submit" className="btn-primary px-5" disabled={loading || !query.trim()}>
            <Send size={15} />
          </button>
        </form>
        <div className="flex gap-4 mt-2.5 text-xs text-[var(--muted)]">
          <span>Or type any support question below</span>
        </div>
      </div>
    </div>
    </div>
  );
}
