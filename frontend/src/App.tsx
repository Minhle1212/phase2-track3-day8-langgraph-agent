import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { MessageSquare, Play, BarChart3, History, Activity, GitBranch } from 'lucide-react';
import ChatPage from './pages/ChatPage';
import ScenariosPage from './pages/ScenariosPage';
import MetricsPage from './pages/MetricsPage';
import HistoryPage from './pages/HistoryPage';
import GraphPage from './pages/GraphPage';

const nav = [
  { to: '/', label: 'Chat', Icon: MessageSquare },
  { to: '/scenarios', label: 'Scenarios', Icon: Play },
  { to: '/metrics', label: 'Metrics', Icon: BarChart3 },
  { to: '/graph', label: 'Graph', Icon: GitBranch },
  { to: '/history', label: 'History', Icon: History },
];

export default function App() {
  return (
    <BrowserRouter>
    <div className="flex min-h-screen relative overflow-hidden">

      {/* Ambient glow orbs */}
      <div className="orb-glow orb-glow-1" />
      <div className="orb-glow orb-glow-2" />

      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-[var(--border)] flex flex-col relative z-10" style={{ background: 'var(--surface)' }}>
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-[var(--border)]">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #4f52d9 100%)' }}>
            <Activity size={15} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--text)]">LangGraph</div>
            <div className="text-xs text-[var(--muted)]">Agent Dashboard</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {nav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-[var(--border)]">
          <div className="text-xs text-[var(--muted)]">LangGraph Agent v1.0</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-grid">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/metrics" element={<MetricsPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </main>
    </div>
    </BrowserRouter>
  );
}
