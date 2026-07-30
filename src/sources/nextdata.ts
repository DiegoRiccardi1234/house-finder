import type { Page } from 'playwright';

/** Legge e parsa lo script #__NEXT_DATA__ (siti Next.js). Null se assente. */
export async function readNextData<T = unknown>(page: Page): Promise<T | null> {
  return page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el ? JSON.parse(el.textContent || 'null') : null;
  }) as Promise<T | null>;
}
