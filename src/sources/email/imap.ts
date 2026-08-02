import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { mailConfigured, mailSettings } from '../../config/mail.js';

export interface EmailMessage {
  uid: number;
  from: string;
  subject: string;
  html: string;
  text: string;
}

/** Casella email letta via IMAP (default: Virgilio). */
export class Mailbox {
  private client: ImapFlow;
  private folder: string;

  constructor() {
    // Le credenziali arrivano da `data/local/mail.json` se ci sono, altrimenti dal `.env`:
    // vedi `src/config/mail.ts`. Prima erano solo env, e dal bundle non c'era modo di scriverle.
    const s = mailSettings();
    if (!s.user || !s.pass) {
      throw new Error('Credenziali email mancanti: impostale in Config → Email.');
    }
    this.folder = s.folder;
    this.client = new ImapFlow({
      host: s.host,
      port: s.port,
      secure: true,
      auth: { user: s.user, pass: s.pass },
      logger: false,
    });
  }

  /** True se le credenziali IMAP sono configurate. */
  static configured(): boolean {
    return mailConfigured();
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
