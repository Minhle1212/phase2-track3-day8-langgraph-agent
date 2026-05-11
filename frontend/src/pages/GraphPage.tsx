import { useEffect, useRef, useState } from 'react';
import { GitBranch, Download, Copy, CheckCircle2, XCircle, Loader2, Share2 } from 'lucide-react';
import { api } from '../api';

interface GraphNode {
  id: string;
  color: string;
  description: string;
}

interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  mermaid: string;
  ascii: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type ViewMode = 'mermaid' | 'ascii' | 'table';

const NODE_COLOR_LABELS: Record<string, string> = {
  '#6366f1': 'accent',
  '#818cf8': 'accent-bright',
  '#22c55e': 'success',
  '#3b82f6': 'info',
  '#f59e0b': 'warning',
  '#a855f7': 'risky',
  '#ef4444': 'danger',
  '#6b7088': 'muted',
};

const EDGE_LABELS: Record<string, string> = {
  simple: 'badge-route-simple',
  tool: 'badge-route-tool',
  missing_info: 'badge-route-missing',
  risky: 'badge-route-risky',
  error: 'badge-route-error',
  dead_letter: 'badge-fail',
  needs_retry: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  success: 'badge-success',
  approved: 'badge-success',
  rejected: 'badge-fail',
};

export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('mermaid');
  const [copied, setCopied] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getGraph()
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load graph'))
      .finally(() => setLoading(false));
  }, []);

  // Render Mermaid diagram when data loads
  useEffect(() => {
    if (view !== 'mermaid' || !data || !diagramRef.current) return;

    const renderDiagram = async () => {
      const el = diagramRef.current;
      if (!el) return;
      el.innerHTML = '';

      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#6366f1',
            primaryTextColor: '#e2e5f0',
            primaryBorderColor: '#32354a',
            lineColor: '#6b7088',
            secondaryColor: '#13161f',
            tertiaryColor: '#1a1e2a',
            background: '#0a0c14',
            mainBkg: '#13161f',
            nodeBorder: '#32354a',
            clusterBkg: '#1a1e2a',
            edgeLabelBackground: '#13161f',
            fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
            fontSize: '13px',
          },
          flowchart: {
            curve: 'basis',
            padding: 20,
            nodeSpacing: 50,
            rankSpacing: 60,
            useMaxWidth: true,
            htmlLabels: true,
          },
        });

        // Extract just the flowchart body from the full mermaid source
        const lines = data.mermaid.split('\n');
        const startIdx = lines.findIndex(l => l.trim().startsWith('flowchart'));
        const bodyLines = lines.slice(startIdx);
        const diagramId = 'graph-diagram-' + Math.random().toString(36).slice(2, 8);
        const { svg } = await mermaid.render(diagramId, bodyLines.join('\n'));
        el.innerHTML = svg;

        // Style the SVG to match the theme
        el.querySelector('svg')?.setAttribute('style', 'max-width: 100%; height: auto;');
      } catch (err) {
        el.innerHTML = `<div class="text-sm text-red-400 p-4">Failed to render diagram: ${err instanceof Error ? err.message : String(err)}</div>`;
      }
    };

    renderDiagram();
  }, [view, data]);

  function copyMermaid() {
    if (!data) return;
    navigator.clipboard.writeText(data.mermaid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="px-8 py-6 page-wrapper">
        <div className="page-content flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading graph...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-8 py-6 page-wrapper">
        <div className="page-content">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <XCircle size={32} className="text-red-400 mx-auto mb-3" />
              <p className="text-red-400 text-sm">{error || 'Failed to load graph'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-6 page-wrapper">
      <div className="page-content">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold page-header flex items-center gap-2">
              <GitBranch size={20} />
              Graph Diagram
            </h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">
              Visual overview of the LangGraph workflow — nodes, edges, and routing logic
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyMermaid}
              className="btn-secondary flex items-center gap-2 text-xs"
              title="Copy Mermaid source"
            >
              {copied ? <CheckCircle2 size={13} className="text-green-400" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy Mermaid'}
            </button>
            <button
              onClick={() => downloadFile(data.mermaid, 'graph.mmd', 'text/plain')}
              className="btn-secondary flex items-center gap-2 text-xs"
            >
              <Download size={13} />
              .mmd
            </button>
            <button
              onClick={() => downloadFile(data.ascii, 'graph.txt', 'text/plain')}
              className="btn-secondary flex items-center gap-2 text-xs"
            >
              <Download size={13} />
              .txt
            </button>
          </div>
        </div>

        {/* View tabs */}
        <div className="flex items-center gap-1 mb-6">
          {(['mermaid', 'ascii', 'table'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                view === v
                  ? 'text-white'
                  : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
              }`}
              style={view === v ? { background: 'linear-gradient(135deg, var(--accent) 0%, #4f52d9 100%)' } : {}}
            >
              {v === 'mermaid' ? 'Flowchart' : v === 'ascii' ? 'ASCII Tree' : 'Edge Table'}
            </button>
          ))}
        </div>

        {/* Mermaid view */}
        {view === 'mermaid' && (
          <div className="space-y-4 animate-fade-in">
            <div className="card p-6 overflow-x-auto flex items-center justify-center min-h-[300px]" style={{ background: 'var(--surface)' }}>
              <div ref={diagramRef} className="w-full flex items-center justify-center" />
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Share2 size={12} />
              <span>Rendered via <a href="https://mermaid.live" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">mermaid.live</a> in your browser</span>
            </div>
          </div>
        )}

        {/* ASCII tree view */}
        {view === 'ascii' && (
          <div className="animate-fade-in">
            <div className="card p-0 overflow-x-auto">
              <pre className="text-xs p-6 leading-relaxed whitespace-pre" style={{
                fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
                color: 'var(--text)',
                background: 'var(--bg)',
                borderRadius: '16px',
              }}>
                {data.ascii}
              </pre>
            </div>
          </div>
        )}

        {/* Edge table view */}
        {view === 'table' && (
          <div className="space-y-4 animate-fade-in">
            {/* Node reference */}
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <h2 className="text-sm font-semibold">Node Reference</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-[var(--muted)] border-b border-[var(--border)]">
                      <th className="py-2.5 px-4 text-left">Node</th>
                      <th className="py-2.5 px-4 text-left">Color</th>
                      <th className="py-2.5 px-4 text-left">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.nodes.map(node => (
                      <tr key={node.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface)]/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: node.color }} />
                            <span className="text-sm font-mono text-[var(--accent)]">{node.id}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: node.color, opacity: 0.5 }} />
                            <span className="text-xs text-[var(--muted)]">{NODE_COLOR_LABELS[node.color] || node.color}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-[var(--muted)]">{node.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Edge table */}
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <h2 className="text-sm font-semibold">Edges</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-[var(--muted)] border-b border-[var(--border)]">
                      <th className="py-2.5 px-4 text-left w-8">#</th>
                      <th className="py-2.5 px-4 text-left">From</th>
                      <th className="py-2.5 px-4 text-left w-16">Type</th>
                      <th className="py-2.5 px-4 text-left">To</th>
                      <th className="py-2.5 px-4 text-left">Label / Condition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.edges.map((edge, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface)]/50 transition-colors">
                        <td className="py-3 px-4 text-xs text-[var(--muted)]">{i + 1}</td>
                        <td className="py-3 px-4">
                          <span className="text-sm font-mono text-[var(--accent)]">{edge.source}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`badge ${edge.label ? (EDGE_LABELS[edge.label] || 'bg-gray-500/20 text-gray-400') : 'bg-gray-500/10 text-gray-600'}`}>
                            {edge.label || 'fixed'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-sm font-mono text-[var(--accent)]">{edge.target}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-[var(--muted)]">
                          {edge.label || <span className="italic opacity-50">unconditional</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Mermaid source preview */}
        {view !== 'mermaid' && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-[var(--muted)]">Mermaid source</p>
              <button onClick={copyMermaid} className="btn-ghost text-xs flex items-center gap-1">
                {copied ? <CheckCircle2 size={11} className="text-green-400" /> : <Copy size={11} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="text-xs rounded-xl p-4 overflow-x-auto leading-relaxed" style={{
              fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
              background: 'var(--bg)',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
            }}>
              {data.mermaid}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
