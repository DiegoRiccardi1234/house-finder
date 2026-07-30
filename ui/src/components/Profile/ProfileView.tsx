import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AiHealth, Meta, SearchProfile, Stats } from '../../types';
import { Alert } from '../../ui/Alert';
import { SearchSummary } from './SearchSummary';
import { PersonalStats } from './PersonalStats';
import { AiStatus } from './AiStatus';

export function ProfileView({
  meta,
  refreshToken,
  onGoToConfig,
  onGoToRun,
}: {
  meta: Meta | null;
  refreshToken: number;
  onGoToConfig: () => void;
  onGoToRun: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [criteria, setCriteria] = useState('');
  const [searches, setSearches] = useState<SearchProfile[]>([]);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.stats(),
      api.getCriteria().then((c) => c.content),
      api.getSearches(),
      api.aiHealth(),
    ])
      .then(([s, c, se, h]) => {
        if (!alive) return;
        setStats(s);
        setCriteria(c);
        setSearches(se);
        setHealth(h);
        setError('');
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  if (error) {
    return (
      <Alert tone="danger" title="Profilo non disponibile">
        {error}. Verifica che il server sia acceso e ricarica la pagina.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <SearchSummary criteria={criteria} searches={searches} onEdit={onGoToConfig} />
      <PersonalStats stats={stats} channels={meta?.channels ?? []} onGoToRun={onGoToRun} />
      <AiStatus health={health} onConfigure={onGoToConfig} />
    </div>
  );
}
