import { useState } from 'react';
import { api } from '../api';
import type { AssistResult, Profile } from '../types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Kicker } from '../ui/Kicker';

/**
 * «Descrivi cosa cerchi»: la via principale per configurare l'app.
 *
 * Davanti a un modulo vuoto — città, etichetta, prezzo, locali minimi, locali massimi — la
 * domanda vera non è *quanto voglio spendere*, è *cosa devo scriverci*. Una frase come la si
 * direbbe a una persona è invece qualcosa che chiunque sa produrre.
 *
 * Quello che l'AI capisce **non viene salvato**: riempie i campi qui sotto, che restano la verità
 * e si correggono. È la differenza fra un aiuto e una magia che decide al posto tuo.
 */

const ESEMPI = [
  'bilocale arredato a Torino sotto 700, zone centrali, no periferie',
  'stanza singola a Bologna entro 450, vicino all\'università',
  'casa da condividere a Milano fino a 1200, almeno tre locali',
];

export function SearchAssist({ onFilled }: { onFilled: (p: Partial<Profile>) => void }) {
  const [testo, setTesto] = useState('');
  const [busy, setBusy] = useState(false);
  const [avviso, setAvviso] = useState<{ tono: 'warn' | 'danger' | 'ok'; titolo: string; testo: string } | null>(
    null,
  );

  async function chiedi(): Promise<void> {
    const frase = testo.trim();
    if (!frase) return;
    setBusy(true);
    setAvviso(null);
    try {
      const res = await api.assistSearch(frase);
      const body = (await res.json()) as AssistResult & { error?: string; detail?: string };

      if (!res.ok) {
        // I tre modi di fallire hanno rimedi diversi, e dirli tutti "errore" li renderebbe
        // indistinguibili: manca la chiave, il modello non ha risposto, la città non esiste.
        setAvviso({
          tono: body.error === 'unknown_city' ? 'warn' : 'danger',
          titolo:
            body.error === 'ai_missing'
              ? 'Serve una chiave AI'
              : body.error === 'unknown_city'
                ? 'Città non disponibile'
                : 'Non ci sono riuscito',
          testo: body.detail ?? 'Riprova, oppure compila i campi qui sotto a mano.',
        });
        return;
      }

      onFilled(body.profile);
      setAvviso(
        body.missing.length > 0
          ? {
              tono: 'warn',
              titolo: 'Ho compilato quello che c\'era',
              testo: `Manca ${body.missing.join(' e ')}: aggiungilo nei campi qui sotto.`,
            }
          : {
              tono: 'ok',
              titolo: 'Fatto',
              testo: 'Controlla i campi qui sotto e correggi quello che non torna, poi salva.',
            },
      );
    } catch (e) {
      setAvviso({ tono: 'danger', titolo: 'Non ci sono riuscito', testo: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <Kicker as="div">il modo più veloce</Kicker>
        <h3 className="text-base text-ink">Descrivi cosa cerchi</h3>
        <p className="text-xs text-muted">
          Scrivilo come lo diresti a una persona. Compilo i campi qui sotto, poi li correggi tu —
          niente viene salvato finché non premi Salva.
        </p>
      </div>

      <textarea
        value={testo}
        onChange={(e) => setTesto(e.target.value)}
        rows={2}
        aria-label="Descrivi cosa cerchi"
        placeholder={ESEMPI[0]}
        className="w-full rounded-[var(--radius-card)] border border-line bg-surface-hi p-3 text-sm text-ink"
        onKeyDown={(e) => {
          // Invio manda, Maiusc+Invio va a capo: è una frase, non un tema.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void chiedi();
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void chiedi()}>
          Compila i campi
        </Button>
        {ESEMPI.slice(1).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setTesto(e)}
            className="text-xs text-accent hover:underline"
          >
            «{e.slice(0, 34)}…»
          </button>
        ))}
      </div>

      {avviso && (
        <Alert tone={avviso.tono === 'ok' ? 'ok' : avviso.tono} title={avviso.titolo}>
          {avviso.testo}
        </Alert>
      )}
    </Card>
  );
}
