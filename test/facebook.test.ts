import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePostId,
  parseMarketplaceId,
  parsePrice,
  firstLine,
  smartTitle,
  cleanText,
  stripFbChrome,
  looksLikeListing,
  isShortTerm,
} from '../src/sources/fb-parse.js';

test('parsePostId: permalink di gruppo', () => {
  assert.equal(parsePostId('https://www.facebook.com/groups/123/posts/456/'), '456');
  assert.equal(parsePostId('https://www.facebook.com/groups/nome.gruppo/permalink/789/'), '789');
  assert.equal(parsePostId('https://www.facebook.com/x?multi_permalinks=555&y=1'), '555');
  assert.equal(parsePostId('https://www.facebook.com/story.php?story_fbid=999&id=1'), '999');
  assert.equal(parsePostId('https://www.facebook.com/groups/123/'), null);
  assert.equal(parsePostId(null), null);
  assert.equal(parsePostId(undefined), null);
});

test('parseMarketplaceId', () => {
  assert.equal(parseMarketplaceId('https://www.facebook.com/marketplace/item/123456789/'), '123456789');
  assert.equal(parseMarketplaceId('https://www.facebook.com/marketplace/item/42?ref=x'), '42');
  assert.equal(parseMarketplaceId('https://www.facebook.com/groups/1/'), null);
  assert.equal(parseMarketplaceId(null), null);
});

test('parsePrice: prezzo da testo libero (ancorato a €/euro)', () => {
  assert.equal(parsePrice('Affittasi bilocale 550€ Crocetta arredato'), 550);
  assert.equal(parsePrice('€ 480 mensili'), 480);
  assert.equal(parsePrice('1.100 € spese incluse'), 1100);
  assert.equal(parsePrice('600 euro al mese'), 600);
  assert.equal(parsePrice('monolocale 35 mq luminoso'), null); // niente €/euro → nessun prezzo
  assert.equal(parsePrice('anno 2024, piano 3'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(null), null);
});

test('firstLine: prima riga non vuota, troncata', () => {
  assert.equal(firstLine('  \n\nCiao mondo\nseconda riga'), 'Ciao mondo');
  assert.equal(firstLine('unica'), 'unica');
  assert.ok(firstLine('x'.repeat(200), 90).length <= 90);
});

test('cleanText: compatta spazi e tronca', () => {
  assert.equal(cleanText('a\n\n  b   c'), 'a b c');
  assert.ok(cleanText('y'.repeat(1000), 500).length <= 500);
});

test('smartTitle: post gruppo salta autore + meta', () => {
  const post = 'Mario Rossi\n· Segui\n11 h\nAffittasi bilocale arredato in Crocetta, 650€';
  assert.match(smartTitle(post, { skipAuthor: true }), /Affittasi bilocale/);
});

test('smartTitle: non salta se la prima riga è già contenuto', () => {
  assert.match(smartTitle('Bilocale in Crocetta 650€\naltro', { skipAuthor: true }), /Bilocale in Crocetta/);
});

test('smartTitle: salta autore + saluto e prende l\'offerta', () => {
  const post = 'Mario Rossi\nCiao\nAffittasi stanza singola in Via Roma';
  assert.match(smartTitle(post, { skipAuthor: true }), /Affittasi stanza singola/);
});

test('smartTitle: marketplace salta la riga solo-prezzo', () => {
  assert.equal(smartTitle('650 €\nBilocale arredato\nTorino, TO', { skipPrice: true }), 'Bilocale arredato');
});

test('stripFbChrome: toglie etichette e barra azioni', () => {
  const s = stripFbChrome('Mario Persona più attiva ti scrivo 3 h Mi piace Rispondi Condividi 2');
  assert.doesNotMatch(s, /Persona più attiva/i);
  assert.doesNotMatch(s, /Rispondi Condividi/i);
});

test('looksLikeListing: tiene le offerte (anche nei commenti)', () => {
  assert.equal(looksLikeListing('Giulia Salve, io ho 3 stanze libere disponibili'), true);
  assert.equal(looksLikeListing('Angela Posso offrirti un monolocale zona centro'), true);
  assert.equal(looksLikeListing('Ila Stanza a un minuto dal policlinico, arredata'), true);
  assert.equal(looksLikeListing('Grazioso Monolocale vicino al centro di Torino'), true);
  assert.equal(looksLikeListing('1 camera da letto 1 bagno Appartamento'), true);
});

test('looksLikeListing: scarta commenti/chrome/non-affitti', () => {
  assert.equal(looksLikeListing('Roberto Barbero Dove? Mi piace Rispondi Condividi'), false);
  assert.equal(looksLikeListing('Persona più attiva Inviato messaggio privato'), false);
  assert.equal(looksLikeListing('ciaoo! ti ho scritto in privato'), false);
  assert.equal(looksLikeListing('Scrivimi in privato'), false);
  assert.equal(looksLikeListing('Cucina con elettrodomestici'), false); // marketplace non-affitto
  assert.equal(looksLikeListing('cameretta intera per bambini'), false);
});

test('looksLikeListing: scarta DOMANDE e VENDITE (anche se citano stanza)', () => {
  assert.equal(looksLikeListing('Ciao sono intresato per la stanza'), false); // domanda
  assert.equal(looksLikeListing('La stanza è ancora disponibile?'), false); // domanda
  assert.equal(looksLikeListing('Cerco stanza singola in zona Murat'), false); // ricerca
  assert.equal(looksLikeListing('Vendo arredamento camera da letto completa'), false); // vendita
  assert.equal(looksLikeListing('Posso offrirti un monolocale zona centro'), true); // "posso offrire" = offerta
});

test('isShortTerm: breve/giornaliero vs mensile', () => {
  assert.equal(isShortTerm('Affitto breve, 50€ a notte'), true);
  assert.equal(isShortTerm('Monolocale disponibile solo per affitti brevi'), true);
  assert.equal(isShortTerm('Bilocale arredato 650€ al mese'), false);
});
