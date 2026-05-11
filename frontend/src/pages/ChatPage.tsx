import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, ChevronRight, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api';
import type { ChatMessage } from '../types';

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
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setLoading(true);
    setError(null);
    setActiveRoute(null);

    try {
      const res = await api.chat(userMsg.content);
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.final_answer || res.pending_question || 'No response.',
        thread_id: res.thread_id,
        route: res.route,
        risk_level: res.risk_level,
        nodes_visited: res.nodes_visited,
        tool_results: res.tool_results,
        errors: res.errors,
        events: res.events,
        pending_question: res.pending_question,
        proposed_action: res.proposed_action,
        approval: res.approval,
        timestamp: new Date(),
      };
      setActiveRoute(res.route);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b border-[var(--border)]">
        <h1 className="text-xl font-semibold">Chat</h1>
        <p className="text-sm text-[var(--muted)] mt-0.5">Ask the agent anything — it routes, retries, and approves automatically.</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center">
              <Bot size={22} className="text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-[var(--text)] font-medium">LangGraph Agent is ready</p>
              <p className="text-sm text-[var(--muted)] mt-1 max-w-sm">
                Try: "What's the status of my order #12345?" or "Refund my last order immediately"
              </p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
              msg.role === 'user'
                ? 'bg-[var(--accent)]'
                : 'bg-[var(--surface)] border border-[var(--border)]'
            }`}>
              {msg.role === 'user'
                ? <User size={14} className="text-white" />
                : <Bot size={14} className="text-[var(--muted)]" />
              }
            </div>

            <div className={`flex-1 min-w-0 max-w-2xl ${msg.role === 'user' ? 'text-right' : ''}`}>
              <div className={`inline-block ${msg.role === 'user' ? '' : 'w-full'}`}>
                <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed text-left ${
                  msg.role === 'user'
                    ? 'bg-[var(--accent)] text-white rounded-tr-sm'
                    : 'bg-[var(--surface)] border border-[var(--border)] rounded-tl-sm'
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
                    {msg.nodes_visited?.length > 0 && (
                      <span className="text-[var(--muted)]">{msg.nodes_visited.length} nodes visited</span>
                    )}
                    {msg.tool_results?.length > 0 && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 size={11} />
                        {msg.tool_results.length} tool call{msg.tool_results.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {msg.errors?.length > 0 && (
                      <span className="flex items-center gap-1 text-red-400">
                        <XCircle size={11} />
                        {msg.errors.length} error{msg.errors.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Pending question */}
                {msg.role === 'assistant' && msg.pending_question && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
                    <AlertTriangle size={11} className="inline mr-1" />
                    Clarification needed: {msg.pending_question}
                  </div>
                )}

                {/* Proposed action for risky queries */}
                {msg.role === 'assistant' && msg.proposed_action && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
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
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
              <Bot size={14} className="text-[var(--muted)]" />
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <Loader2 size={14} className="animate-spin" />
              Agent is thinking...
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            <XCircle size={14} />
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-8 py-5 border-t border-[var(--border)]">
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
          <span>Try: "check order status"</span>
          <span>·</span>
          <span>"refund my last order"</span>
          <span>·</span>
          <span>"fix the server error"</span>
        </div>
      </div>
    </div>
  );
}
