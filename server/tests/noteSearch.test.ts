import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markdownLines, parseNoteSearch, runNoteSearch, searchHasMarkdown, type SearchFlags } from '../../shared/noteSearch.ts';

const FLAGS: SearchFlags = { caseSensitive: false, wholeWord: false, regexp: false };
const NOTE = [
  '# Projet',
  'Le **salut** du paiement par carte. #urgent',
  '- [ ] Écrire les tests du paiement',
  '- [x] Relire le paiement en ligne',
  '## Sécurité',
  'Chiffrer le paiement et la carte.',
  '```js',
  '- [ ] pas une tâche',
  '```',
].join('\n');

function find(input: string, flags: Partial<SearchFlags> = {}): string[] {
  const parsed = parseNoteSearch(input, { ...FLAGS, ...flags });
  return runNoteSearch(parsed, NOTE, markdownLines(NOTE)).map((match) => NOTE.slice(match.from, match.to));
}

describe('recherche dans une note, syntaxe d’Obsidian', () => {
  it('cherche le texte tel quel, Markdown compris', () => {
    assert.deepEqual(find('**s'), ['**s']);
    assert.deepEqual(find('paiement par'), ['paiement par']);
    assert.deepEqual(find('PAIEMENT').length, 4);
    assert.deepEqual(find('PAIEMENT', { caseSensitive: true }), []);
    assert.deepEqual(find('f(x)'), [], 'parenthèses prises telles quelles');
    assert.deepEqual(find('-5'), [], 'une exclusion seule est cherchée comme du texte');
  });

  it('phrases, OR, exclusion et expressions régulières', () => {
    assert.deepEqual(find('"la carte"'), ['la carte']);
    assert.deepEqual(find('carte OR tests'), ['carte', 'tests', 'carte']);
    assert.deepEqual(find('carte -inexistant'), ['carte', 'carte']);
    assert.deepEqual(find('carte -chiffrer'), [], 'le mot exclu est dans la note');
    assert.deepEqual(find('/pai\\w+ en/'), ['paiement en']);
    assert.equal(parseNoteSearch('/(/', FLAGS).error !== null, true);
    assert.deepEqual(find('ment (', { regexp: true }), [], 'expression invalide : aucun résultat');
  });

  it('casse par terme, étiquettes et tâches', () => {
    assert.deepEqual(find('match-case:Chiffrer OR match-case:relire'), ['Chiffrer']);
    assert.deepEqual(find('ignore-case:CARTE', { caseSensitive: true }), ['carte', 'carte']);
    assert.deepEqual(find('tag:#urgent'), ['#urgent']);
    assert.deepEqual(find('tag:urg'), [], 'une étiquette entière');
    assert.deepEqual(find('task-todo:paiement'), ['paiement']);
    assert.deepEqual(find('task-done:paiement'), ['paiement']);
    assert.deepEqual(find('task:paiement').length, 2);
    assert.deepEqual(find('task-todo:'), ['Écrire les tests du paiement'], 'sans terme : toute la tâche, hors blocs de code');
  });

  it('même ligne et même section', () => {
    assert.deepEqual(find('line:(paiement carte)'), ['paiement', 'carte', 'paiement', 'carte']);
    assert.deepEqual(find('line:(paiement -carte)').length, 2, 'les deux tâches');
    assert.deepEqual(find('section:(chiffrer carte)'), ['Chiffrer', 'carte']);
    assert.deepEqual(find('section:(tests chiffrer)'), [], 'pas dans la même section');
    assert.equal(parseNoteSearch('line:', FLAGS).error !== null, true);
  });

  it('repère la syntaxe Markdown dans une recherche', () => {
    assert.equal(searchHasMarkdown('**s'), true);
    assert.equal(searchHasMarkdown('`code`'), true);
    assert.equal(searchHasMarkdown('> citation'), true);
    assert.equal(searchHasMarkdown('mot de passe'), false);
    assert.equal(searchHasMarkdown('#urgent'), false);
  });
});
