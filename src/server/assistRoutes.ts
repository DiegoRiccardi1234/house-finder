import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { aiDisponibile, ask } from '../ai/ask.js';
import { CITIES, findCity, isKnownCity, labelOf } from '../config/cities.js';
import { loadZoneSeed } from '../config/zones.js';
import type { Profile, SearchRow } from '../config/profile.js';

/**
 * L'aiuto dell'AI dove serve davvero: al momento di configurare.
 *
 * L'app chiedeva di digitare i quartieri a memoria in un campo vuoto e di tradurre "bilocale" in
 * `Locali min 2 / Locali max 2`. Non era un aiuto, era un compito — e chi apriva quella schermata
 * per la prima volta non aveva modo di sapere cosa scriverci.
 *
 * Qui l'AI fa due cose sole, e nessuna delle due è obbligatoria: legge una frase e ne ricava un
 * profilo, ed elenca i quartieri di una città. Se manca la chiave, o il modello non risponde, i
 * campi restano compilabili a mano esattamente come prima.
 */

const NOMI_CITTA = CITIES.map((c) => `${c.slug} (${c.label})`).join(', ');

const RichiestaAI = z.object({
  city: z.string().nullable().optional(),
  maxPrice: z.number().nullable().optional(),
  minRooms: z.number().nullable().optional(),
  maxRooms: z.number().nullable().optional(),
  kind: z.string().nullable().optional(),
  musts: z.array(z.string()).nullable().optional(),
  zonesKeep: z.array(z.string()).nullable().optional(),
  zonesAvoid: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const ZoneAI = z.object({
  zones: z.array(z.string()),
});

const SYSTEM_RICERCA = `Sei l'assistente di un'app che cerca case in affitto in Italia.
Leggi la frase dell'utente e rispondi SOLO con un oggetto JSON, senza commenti.

Campi:
- city: lo slug della città, scelto ESATTAMENTE da questo elenco: ${NOMI_CITTA}. null se non la nomina.
- maxPrice: numero, euro al mese. null se non lo dice.
- minRooms / maxRooms: numero di locali. "bilocale" = 2 e 2, "trilocale" = 3 e 3,
  "stanza singola" = 1 e 1, "casa da condividere" = almeno 3 (minRooms 3, maxRooms null).
- kind: una fra "stanza", "bilocale", "trilocale", "condivisa", oppure null.
- musts: requisiti irrinunciabili, in italiano, forma breve ("Arredato", "Ascensore", "Balcone").
- zonesKeep / zonesAvoid: SOLO nomi propri di quartieri, come "Bolognina" o "San Salvario".
  Se l'utente dice "vicino al centro", "zone centrali", "no periferie" o simili, NON inventare
  quartieri e NON mettere parole generiche come "centro" o "periferia": lascia le liste vuote e
  riporta la frase in notes. Chi legge sceglierà i quartieri da un elenco.
- notes: le sfumature che non entrano negli altri campi, con le parole dell'utente.

Non inventare valori che l'utente non ha detto: metti null.`;

const SYSTEM_ZONE = `Elenchi i quartieri di una città italiana.
Rispondi SOLO con {"zones": ["...", "..."]}, senza commenti.
Usa i nomi con cui li chiamano gli abitanti e gli annunci immobiliari, non i codici delle
circoscrizioni. Da 12 a 30 voci, dalle più centrali alle più periferiche. Niente comuni limitrofi.`;

export function createAssistRouter(): Router {
  const r = Router();

  const requireJson = (req: Request, res: Response): boolean => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Content-Type application/json richiesto' });
      return true;
    }
    return false;
  };

  /**
   * Una frase → un profilo di ricerca.
   *
   * La città proposta si valida contro l'elenco: se il modello inventa un comune che i portali
   * non sanno aprire, si dice quale invece di salvarlo. È la stessa guardia della PUT del
   * profilo, ripetuta qui perché questo è il punto in cui il valore *nasce*.
   */
  r.post('/assist/search', async (req, res) => {
    if (requireJson(req, res)) return;
    const frase = typeof (req.body as { text?: unknown }).text === 'string'
      ? ((req.body as { text: string }).text).trim()
      : '';
    if (!frase) return res.status(400).json({ error: 'scrivi cosa cerchi' });
    if (!aiDisponibile()) {
      return res.status(409).json({
        error: 'ai_missing',
        detail: 'Serve una chiave AI: impostala in Config → Provider AI. I campi qui sotto restano compilabili a mano.',
      });
    }

    const out = await ask(SYSTEM_RICERCA, frase, RichiestaAI, { maxTokens: 700 });
    if (!out) {
      return res.status(502).json({
        error: 'ai_failed',
        detail: 'Il modello non ha risposto. Riprova, oppure compila i campi a mano.',
      });
    }

    const cittaProposta = (out.city ?? '').trim().toLowerCase();
    if (cittaProposta && !isKnownCity(cittaProposta)) {
      return res.status(422).json({
        error: 'unknown_city',
        city: cittaProposta,
        detail: `Ho capito "${cittaProposta}", ma non è fra le città disponibili. Scegline una dall'elenco.`,
      });
    }

    const city = cittaProposta || null;
    const searches: SearchRow[] = [];
    if (city && out.maxPrice && out.maxPrice > 0) {
      searches.push({
        id: '',
        city,
        label: `${labelOf(city)} · ${out.kind ?? 'casa'}`,
        maxPrice: Math.round(out.maxPrice),
        ...(out.minRooms ? { minRooms: Math.round(out.minRooms) } : {}),
        ...(out.maxRooms ? { maxRooms: Math.round(out.maxRooms) } : {}),
      });
    }

    // Rete di sicurezza sul prompt: "centro" e "periferia" non sono quartieri, e un modello che
    // li propone comunque non deve riuscire a infilarli fra i nomi propri.
    const GENERICI = /^(centro|centro citt|periferi|semicentro|zone? |quartieri? |vicino)/i;
    const zoneVere = (l: string[] | null | undefined): string[] =>
      (l ?? []).map((z) => z.trim()).filter((z) => z.length > 2 && !GENERICI.test(z));

    const keep = zoneVere(out.zonesKeep);
    const avoid = zoneVere(out.zonesAvoid);

    const profile: Partial<Profile> = {
      searches,
      zones: city && (keep.length > 0 || avoid.length > 0) ? [{ city, keep, avoid }] : [],
      musts: out.musts ?? [],
      notes: out.notes ?? '',
    };

    // `city` senza prezzo, o viceversa: si dice cosa manca invece di consegnare mezzo profilo
    // e lasciare che l'utente scopra da solo perché non funziona.
    const mancano: string[] = [];
    if (!city) mancano.push('la città');
    if (!out.maxPrice) mancano.push('il budget massimo');

    res.json({ profile, missing: mancano, city });
  });

  /**
   * I quartieri di una città.
   *
   * Prima l'elenco incluso nell'app, se c'è: è immediato, non consuma quota e non richiede una
   * chiave — che al primo avvio spesso non c'è ancora. L'AI interviene per le città che un
   * elenco scritto a mano non coprirà mai.
   */
  r.get('/assist/zones/:city', async (req, res) => {
    const slug = (req.params.city ?? '').trim().toLowerCase();
    const city = findCity(slug);
    if (!city) return res.status(404).json({ error: 'unknown_city', city: slug });

    const seed = loadZoneSeed(slug);
    if (seed.length > 0) return res.json({ city: slug, zones: seed, source: 'incluso' });

    if (!aiDisponibile()) {
      return res.json({
        city: slug,
        zones: [],
        source: 'nessuna',
        detail: `Per ${city.label} non ho un elenco già pronto. Con una chiave AI posso proporteli, oppure scrivili tu.`,
      });
    }
    const out = await ask(SYSTEM_ZONE, `Città: ${city.label}.`, ZoneAI, { maxTokens: 600 });
    if (!out) {
      return res.json({
        city: slug,
        zones: [],
        source: 'nessuna',
        detail: 'Il modello non ha risposto. Riprova, oppure scrivi i quartieri a mano.',
      });
    }
    const zones = Array.from(
      new Set(out.zones.map((z) => z.trim()).filter((z) => z.length > 1 && z.length < 40)),
    );
    res.json({ city: slug, zones, source: 'ai' });
  });

  return r;
}
