import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AiHealth, Meta, Profile, Stats } from '../../types';
import { Alert } from '../../ui/Alert';
import { SearchSummary } from './SearchSummary';
import { PersonalStats } from './PersonalStats';
import { AiStatus } from './AiStatus';

export function ProfileView({
  meta,
  refreshToken,
  onEditSearch,
  onGoToProviders,
  onGoToRun,
}: {
  meta: Meta | null;
  refreshToken: number;
  /** Porta all'editor della ricerca, non a un file di testo: vedi `apriConfig` in App. */
  onEditSearch: () => void;
  onGoToProviders: () => void;
  onGoToRun: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [error, setError] = useState('');

  /**
   * Le tre schede si caricano **separatamente**.
   *
   * Prima era un solo `Promise.all` di quattro chiamate: se una qualsiasi falliva spariva
   * l'intera schermata, statistiche comprese, sostituita da un errore. Una card che non carica
   * deve togliere di mezzo sé stessa, non le altre.
   */
  useEffect(() => {
    let alive = true;
    api.stats().then((s) => alive && setStats(s)).catch((e: Error) => alive && setError(e.message));
    // La ricerca si legge dal profilo strutturato, la stessa fonte che modifica l'editor. Prima
    // si rileggeva il markdown generato e lo si ri-parsava con delle regex: due viste della
    // stessa cosa, che infatti davano due conteggi diversi di quartieri.
    api.getProfile().then((s) => alive && setProfile(s.profile)).catch(() => {});
    api.aiHealth().then((h) => alive && setHealth(h)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert tone="danger" title="Statistiche non disponibili">
          {error}. Verifica che il server sia acceso e ricarica la pagina.
        </Alert>
      )}
      <SearchSummary profile={profile} onEdit={onEditSearch} />
      <PersonalStats stats={stats} channels={meta?.channels ?? []} onGoToRun={onGoToRun} />
      <AiStatus health={health} onConfigure={onGoToProviders} />
    </div>
  );
}
