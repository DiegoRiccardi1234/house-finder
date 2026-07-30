import type { EmailSource } from '../../core/types.js';
import { extractFromHtml } from './extract-html.js';

// Mail delle ricerche salvate di Idealista.
// Link dettaglio: https://www.idealista.it/immobili/<id>/
export const idealistaEmail: EmailSource = {
  name: 'idealista',
  matchesSender: (from) => /idealista\.(it|com)/i.test(from),
  parse: (html) => extractFromHtml(html, 'idealista', /idealista\.it\/immobili\/(\d+)/),
};
