import { useState } from 'react';
import { useMeta } from './hooks';
import { Dashboard } from './components/Dashboard';
import { RunPanel } from './components/RunPanel';
import { ConfigView } from './components/ConfigView';

type View = 'dashboard' | 'run' | 'config';

const NAV: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Annunci' },
  { id: 'run', label: 'Cerca' },
  { id: 'config', label: 'Config' },
];

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const meta = useMeta();

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">
          🏠 House Finder
        </h1>
        <nav className="flex gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                view === n.id
                  ? 'bg-teal-700 text-white'
                  : 'text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        {meta && !meta.imapConfigured && (
          <span className="ml-auto rounded-lg bg-amber-100 px-3 py-1 text-xs text-amber-800">
            IMAP non configurato — canale email spento
          </span>
        )}
      </header>

      {view === 'dashboard' && <Dashboard />}
      {view === 'run' && <RunPanel meta={meta} onDone={() => {}} />}
      {view === 'config' && <ConfigView />}
    </div>
  );
}
