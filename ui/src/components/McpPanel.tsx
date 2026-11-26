import { useState } from 'react';
import { agentJson, type Proposal } from '../agent-api';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';

/**
 * Collegare un assistente esterno (Codex, Claude Desktop…) all'app tramite MCP.
 *
 * Stava fra le connessioni AI, come quinta scheda, ma è un'altra cosa: non è l'AI che usa l'app,
 * è l'app che si fa usare da un assistente. Vive in App, sotto «Avanzate».
 */

function ProposalSummary({ proposal }: { proposal: Proposal }) {
  const p = proposal.payload as { channels?: string[]; searches?: { label: string; city: string; maxPrice: number; minRooms?: number; maxRooms?: number }[];
    zones?: { city: string; keep: string[]; avoid: string[] }[]; musts?: string[]; notes?: string };
  if (proposal.kind === 'scan') return <p className="my-3 text-sm">Raccogliere annunci dalle fonti: {p.channels?.join(', ')}. La proposta non esegue valutazioni AI.</p>;
  return (
    <div className="my-3 space-y-2 text-sm">
      {p.searches?.map((search, i) => <p key={i}><b>{search.label || search.city}</b>: fino a {search.maxPrice} €/mese, locali {search.minRooms ?? 'qualsiasi'} – {search.maxRooms ?? 'senza massimo'}.</p>)}
      {p.zones?.map((zone, i) => <p key={i}>{zone.city}: preferiti {zone.keep.join(', ') || 'nessuna preferenza'}; da evitare {zone.avoid.join(', ') || 'nessuna esclusione'}.</p>)}
      <p>Requisiti: {p.musts?.join('; ') || 'nessuno'}</p>
      <p className="whitespace-pre-wrap break-words">Note: {p.notes || 'nessuna'}</p>
    </div>
  );
}

export function McpPanel({ onChanged }: { onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [setup, setSetup] = useState<{ codexConfig: string } | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const refresh = async () => setProposals((await agentJson<{ proposals: Proposal[] }>('/api/agent/proposals')).proposals);

  return (
    <Card>
      <CardHeader title="Assistenti esterni (MCP)" />
      <div className="flex flex-col gap-3 p-4">
        <p className="max-w-[72ch] text-sm text-muted">
          Per usare House Finder da un assistente come Codex o Claude Desktop. L'app deve essere aperta. L'assistente può
          leggere gli annunci e cambiarne lo stato; le modifiche alla ricerca e le scansioni arrivano qui come proposte da confermare.
        </p>
        {error && <Alert tone="danger" title="Operazione non riuscita">{error}</Alert>}
        {message && <p role="status" className="text-sm text-ok">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => act(async () => setSetup(await agentJson('/api/agent/setup', 'POST', {})))}>Prepara il collegamento</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(refresh)}>Mostra le proposte</Button>
        </div>
        {setup && (
          <details open>
            <summary className="cursor-pointer text-sm">Configurazione da incollare nell'assistente</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-surface-hi p-3 text-xs">{setup.codexConfig}</pre>
            <Button size="sm" onClick={() => { void navigator.clipboard.writeText(setup.codexConfig).then(() => setMessage('Configurazione copiata.')).catch(() => setError('Copia non disponibile: seleziona il testo.')); }}>Copia</Button>
          </details>
        )}
        {proposals && proposals.length === 0 && <p className="text-sm text-muted">Nessuna proposta in attesa.</p>}
        {proposals?.map((p) => (
          <div key={p.id} className="border-t border-hair pt-3">
            <h4 className="text-base">{p.kind === 'profile' ? 'Modifica della ricerca' : 'Scansione delle fonti'} · {p.state}</h4>
            <ProposalSummary proposal={p} />
            {p.state === 'pending' && (
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={busy} onClick={() => act(async () => { await agentJson(`/api/agent/proposals/${p.id}/confirm`, 'POST', {}); await refresh(); onChanged?.(); })}>Conferma</Button>
                <Button size="sm" disabled={busy} onClick={() => act(async () => { await agentJson(`/api/agent/proposals/${p.id}/reject`, 'POST', {}); await refresh(); })}>Rifiuta</Button>
              </div>
            )}
            {p.error && <p className="text-sm text-danger">{p.error}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
