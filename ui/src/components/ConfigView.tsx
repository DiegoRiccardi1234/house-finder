import { useEffect, useState } from 'react';
import { api } from '../api';
import { ConnectionsPanel } from './ConnectionsPanel';
import { UpdatePanel } from './UpdatePanel';
import { BrowsersPanel } from './BrowsersPanel';
import { MailPanel } from './MailPanel';
import { FacebookSession } from './FacebookSession';
import { FacebookGroups } from './FacebookGroups';
import { SearchEditor } from './SearchEditor';
import { McpPanel } from './McpPanel';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cx } from '../ui/cx';
import type { Meta } from '../types';

export type ConfigTab = 'search' | 'email' | 'facebook' | 'providers' | 'app';
type Danger = 'reset' | 'refilter' | null;

/**
 * Le impostazioni, divise per **cosa vuoi fare**, con una barra laterale che dice a colpo d'occhio
 * cosa è a posto e cosa no.
 *
 * Prima erano cinque schede in alto, e dentro «Connessioni AI» altre cinque: per sapere se Facebook
 * era collegato o l'AI pronta bisognava aprire la sezione. Ora ogni voce porta il suo stato.
 * Le sezioni si montano alla prima visita e poi restano vive: le modifiche non salvate non si
 * perdono cambiando sezione.
 */
const SECTIONS: { id: ConfigTab; label: string }[] = [
  { id: 'search', label: 'La tua ricerca' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'email', label: 'Email' },
  { id: 'providers', label: 'Intelligenza artificiale' },
  { id: 'app', label: 'App e archivio' },
];

function statusOf(id: ConfigTab, meta?: Meta | null): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!meta) return { text: '', tone: 'muted' };
  switch (id) {
    case 'search':
      return meta.profileConfigured ? { text: 'Configurata', tone: 'ok' } : { text: 'Da completare', tone: 'warn' };
    case 'facebook':
      return meta.fbSessionExists ? { text: 'Collegato', tone: 'ok' } : { text: 'Non collegato', tone: 'muted' };
    case 'email':
      return meta.imapConfigured ? { text: 'Collegata', tone: 'ok' } : { text: 'Facoltativa', tone: 'muted' };
    case 'providers':
      return meta.aiConfigured ? { text: 'Pronta', tone: 'ok' } : { text: 'Da configurare', tone: 'warn' };
    case 'app':
      return meta.browsersInstalled ? { text: `Versione ${meta.version}`, tone: 'muted' } : { text: 'Mancano i browser', tone: 'warn' };
  }
}

export function ConfigView({
  onProvidersChanged,
  openTab,
  meta,
  onArchiveChanged,
}: {
  onProvidersChanged?: () => void;
  /** Sezione da aprire su richiesta esterna (il badge dell'header, il tasto Modifica del profilo). */
  openTab?: ConfigTab | null;
  meta?: Meta | null;
  onArchiveChanged: () => void;
}) {
  const [tab, setTab] = useState<ConfigTab>('search');
  const [viste, setViste] = useState<Set<ConfigTab>>(new Set(['search']));
  const vai = (t: ConfigTab): void => {
    setTab(t);
    setViste((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  };

  useEffect(() => {
    if (openTab) vai(openTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTab]);

  const [danger, setDanger] = useState<Danger>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [archiveMsg, setArchiveMsg] = useState('');
  const [rulesBusy, setRulesBusy] = useState(false);

  async function runDanger() {
    setDangerBusy(true);
    try {
      if (danger === 'reset') {
        const r = await api.resetListings();
        setArchiveMsg(`Archivio svuotato: ${r.cleared} annunci rimossi.`);
      } else {
        const r = await api.refilterListings();
        setArchiveMsg(`Ripulito: ${r.removed} rimossi, restano ${r.after}.`);
      }
      onArchiveChanged();
    } catch (e) {
      setArchiveMsg(`Errore: ${(e as Error).message}`);
    } finally {
      setDangerBusy(false);
      setDanger(null);
    }
  }

  async function reapply() {
    setRulesBusy(true);
    try {
      const r = await api.reapplyRules();
      setArchiveMsg(`Regole applicate: ${r.dismissed ?? 0} scartati, ${r.restored ?? 0} rimessi fra i nuovi, ${r.ask ?? 0} da chiedere.`);
      onArchiveChanged();
    } catch (e) {
      setArchiveMsg(`Errore: ${(e as Error).message}`);
    } finally {
      setRulesBusy(false);
    }
  }

  const panel = (id: ConfigTab, node: React.ReactNode) =>
    viste.has(id) && (
      <div hidden={tab !== id} className="flex min-w-0 flex-col gap-4">
        <h2 className="text-2xl text-ink">{SECTIONS.find((s) => s.id === id)?.label}</h2>
        {node}
      </div>
    );

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <nav aria-label="Sezioni delle impostazioni" className="lg:sticky lg:top-4 lg:w-60 lg:shrink-0">
        <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {SECTIONS.map((s) => {
            const st = statusOf(s.id, meta);
            const active = tab === s.id;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => vai(s.id)}
                  className={cx(
                    'flex w-full flex-col items-start rounded-[var(--radius-btn)] px-3 py-2 text-left transition-colors',
                    active ? 'bg-accent text-on-accent' : 'text-ink hover:bg-surface-3',
                  )}
                >
                  <span className="text-sm font-medium">{s.label}</span>
                  {st.text && (
                    <span className={cx('text-xs', active ? 'text-on-accent/80' : st.tone === 'ok' ? 'text-ok' : st.tone === 'warn' ? 'text-warn' : 'text-muted')}>
                      {st.tone === 'warn' ? '● ' : ''}{st.text}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">
        {panel('search', <SearchEditor onSaved={() => { onProvidersChanged?.(); onArchiveChanged(); }} />)}
        {panel('facebook', (
          <>
            {/* La sessione sta sopra l'elenco: senza accesso, i gruppi non si possono leggere. */}
            <FacebookSession onChanged={onProvidersChanged} />
            <FacebookGroups />
          </>
        ))}
        {panel('email', <MailPanel onChanged={onProvidersChanged} />)}
        {panel('providers', <ConnectionsPanel onChanged={onProvidersChanged} />)}
        {panel('app', (
          <>
            <UpdatePanel />
            <BrowsersPanel meta={meta ?? null} onChanged={onProvidersChanged} />

            <Card>
              <CardHeader title="Archivio degli annunci" />
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="secondary" loading={rulesBusy} onClick={() => void reapply()}>Riapplica le regole</Button>
                  <p className="flex-1 text-sm text-muted">
                    Ricontrolla tutti gli annunci con la ricerca attuale (tipo di casa, prezzo, area, vincoli). Non usa l'AI e non tocca
                    quelli che hai segnato tu.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-hair pt-3">
                  <Button variant="secondary" onClick={() => setDanger('refilter')}>Ripulisci il rumore</Button>
                  <Button variant="danger" onClick={() => setDanger('reset')}>Svuota l'archivio</Button>
                  <p className="flex-1 text-sm text-muted">
                    <b>Ripulisci</b> toglie commenti Facebook e non-affitti. <b>Svuota</b> cancella tutto: alla prossima ricerca gli
                    annunci vengono ritrovati e rivalutati da zero. Nessuno dei due si può annullare.
                  </p>
                </div>
                {archiveMsg && <p role="status" className="text-sm text-ink-soft">{archiveMsg}</p>}
              </div>
            </Card>

            <details className="rounded-[var(--radius-card)] border border-hair bg-surface-2">
              <summary className="cursor-pointer px-4 py-3 text-lg text-ink" style={{ fontFamily: 'var(--font-display)' }}>Avanzate</summary>
              <div className="border-t border-hair p-4">
                <McpPanel onChanged={onProvidersChanged} />
              </div>
            </details>
          </>
        ))}
      </div>

      <ConfirmDialog
        open={danger !== null}
        busy={dangerBusy}
        title={danger === 'reset' ? 'Svuotare tutto l’archivio?' : 'Ripulire il rumore?'}
        confirmLabel={danger === 'reset' ? 'Svuota' : 'Ripulisci'}
        onCancel={() => setDanger(null)}
        onConfirm={runDanger}
      >
        {danger === 'reset'
          ? 'Vengono cancellati tutti gli annunci, i voti e gli stati (preferiti, contattati). Alla prossima ricerca verranno ritrovati e rivalutati da zero, consumando quota AI.'
          : 'Vengono rimossi i record riconosciuti come rumore (commenti Facebook, elementi di interfaccia, annunci che non sono affitti). L’operazione non usa l’AI e non è reversibile.'}
      </ConfirmDialog>
    </div>
  );
}
