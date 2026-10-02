import type { EmailSource } from '../../core/types.js';
import { extractFromHtml, resolveFromHtml } from './extract-html.js';

// Mail delle ricerche salvate di Idealista.
// Il percorso attuale è /immobile/<id>/; accetta anche il plurale delle vecchie fixture.
const linkRe = /idealista\.it\/immobil[ie]\/(\d+)/;
export const idealistaEmail: EmailSource = {
  name: 'idealista',
  matchesSender: (from) => /idealista\.(it|com)/i.test(from),
  parse: (html) => extractFromHtml(html, 'idealista', linkRe),
  resolve: (html, _text, resolver) => resolveFromHtml(html, 'idealista', linkRe, resolver),
};
