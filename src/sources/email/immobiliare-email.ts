import type { EmailSource } from '../../core/types.js';
import { extractFromHtml } from './extract-html.js';

// Mail delle ricerche salvate di Immobiliare.it.
// Link dettaglio: https://www.immobiliare.it/annunci/<id>/
export const immobiliareEmail: EmailSource = {
  name: 'immobiliare',
  matchesSender: (from) => /immobiliare\.it/i.test(from),
  parse: (html) => extractFromHtml(html, 'immobiliare', /immobiliare\.it\/annunci\/(\d+)/),
};
