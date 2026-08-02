import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '../core/atomic.js';
import { localConfigPath } from './paths.js';

/**
 * Credenziali della casella email, configurabili dalla UI.
 *
 * Prima vivevano solo nel `.env`, cioè in un file di testo da aprire col blocco note: le key AI
 * si incollavano nella UI e la password della posta no. Per chi usa l'app dal bundle — dove non
 * c'è né npm né un terminale — quella era la differenza fra "il canale email funziona" e "il
 * canale email non è raggiungibile affatto".
 *
 * Stesso schema delle credenziali AI (`src/ai/credentials.ts`): file in `data/local/`, che è già
 * gitignorato e già escluso dal bundle di release, e **la password non torna mai al client**.
 * Verso la UI escono host, utente e un booleano; il valore proprio non viene serializzato, così
 * non può finire in un log, in una cache del browser o in uno screenshot.
 */
export interface MailFile {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  folder?: string;
}

const FILE = 'mail.json';
/** Il provider storico di Diego. Resta il default perché è quello documentato nel README. */
export const DEFAULT_MAIL_HOST = 'in.virgilio.it';
export const DEFAULT_MAIL_PORT = 993;
export const DEFAULT_MAIL_FOLDER = 'INBOX';

let cache: MailFile | null = null;

function path(): string {
  return localConfigPath(FILE);
}

export function loadMail(): MailFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(path(), 'utf8')) as MailFile;
  } catch {
    cache = {};
  }
  return cache;
}

export function invalidateMail(): void {
  cache = null;
}

export interface MailSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  folder: string;
}

/**
 * File > env, come per le key AI: chi scrive la password nella UI si aspetta che vinca su quella
 * di sistema, altrimenti cambia il campo e non succede niente.
 */
export function mailSettings(): MailSettings {
  const f = loadMail();
  return {
    host: f.host || process.env.IMAP_HOST || DEFAULT_MAIL_HOST,
    port: f.port ?? Number(process.env.IMAP_PORT ?? DEFAULT_MAIL_PORT),
    user: f.user || process.env.IMAP_USER || '',
    pass: f.pass || process.env.IMAP_PASS || '',
    folder: f.folder || process.env.IMAP_FOLDER || DEFAULT_MAIL_FOLDER,
  };
}

export function mailConfigured(): boolean {
  const s = mailSettings();
  return Boolean(s.user && s.pass);
}

/** Quello che si può mostrare: tutto tranne la password. */
export function mailPublic(): { host: string; port: number; user: string; folder: string; configured: boolean; fromEnv: boolean } {
  const s = mailSettings();
  const f = loadMail();
  return {
    host: s.host,
    port: s.port,
    user: s.user,
    folder: s.folder,
    configured: mailConfigured(),
    // Serve a spiegare perché il campo password sembra vuoto ma il canale funziona.
    fromEnv: !f.pass && Boolean(process.env.IMAP_PASS),
  };
}

/** `undefined` = non toccare, stringa vuota = cancella. */
export async function saveMail(patch: Partial<MailFile>): Promise<void> {
  const cur = loadMail();
  const next: MailFile = { ...cur };
  for (const [k, v] of Object.entries(patch) as Array<[keyof MailFile, unknown]>) {
    if (v === undefined) continue;
    if (v === '' || v === null) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  await writeFileAtomic(path(), JSON.stringify(next, null, 2) + '\n');
  cache = next;
}
