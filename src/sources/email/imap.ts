import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface EmailMessage {
  uid: number;
  from: string;
  subject: string;
  html: string;
  text: string;
}

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} mancante (vedi .env)`);
  return v;
}

/** Casella email letta via IMAP (default: Virgilio). */
export class Mailbox {
  private client: ImapFlow;
  private folder: string;

  constructor() {
    this.folder = process.env.IMAP_FOLDER ?? 'INBOX';
    this.client = new ImapFlow({
      host: process.env.IMAP_HOST ?? 'in.virgilio.it',
      port: Number(process.env.IMAP_PORT ?? '993'),
      secure: true,
      auth: { user: reqEnv('IMAP_USER'), pass: reqEnv('IMAP_PASS') },
      logger: false,
    });
  }

  /** True se le credenziali IMAP sono configurate. */
  static configured(): boolean {
    return !!(process.env.IMAP_USER && process.env.IMAP_PASS);
  }

  async open(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      /* ignore */
    }
  }

  /** Legge le mail non lette nella cartella target (senza marcarle). */
  async fetchUnread(): Promise<EmailMessage[]> {
    const out: EmailMessage[] = [];
    const lock = await this.client.getMailboxLock(this.folder);
    try {
      const uids = (await this.client.search({ seen: false }, { uid: true })) || [];
      if (!uids.length) return out;
      for await (const msg of this.client.fetch(uids, { uid: true, source: true, envelope: true }, { uid: true })) {
        const source = msg.source;
        if (!source) continue;
        const parsed = await simpleParser(source);
        out.push({
          uid: msg.uid,
          from: parsed.from?.text ?? msg.envelope?.from?.[0]?.address ?? '',
          subject: parsed.subject ?? msg.envelope?.subject ?? '',
          html: typeof parsed.html === 'string' ? parsed.html : '',
          text: parsed.text ?? '',
        });
      }
    } finally {
      lock.release();
    }
    return out;
  }

  /** Marca come lette le mail già processate (così non le rilegge). */
  async markSeen(uids: number[]): Promise<void> {
    if (!uids.length) return;
    const lock = await this.client.getMailboxLock(this.folder);
    try {
      await this.client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
  }
}
