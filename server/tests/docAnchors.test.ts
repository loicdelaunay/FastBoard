import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anchorLine, headingSlug, lineAnchor } from '../../shared/docAnchors.ts';
import { docOutline } from '../../shared/docOutline.ts';

/** Ancre d'adresse de la documentation : l'endroit lu, retrouvé au retour et par un lien partagé. */
describe('ancres d’adresse des notes', () => {
  const text = [
    'Introduction sans titre', // 1
    '', // 2
    '# Guide', // 3
    'texte', // 4
    '## Étape 2 : déployer', // 5
    'a', // 6
    'b', // 7
    'c', // 8
    '## Installation', // 9
    'x', // 10
    '## Installation', // 11
    'y', // 12
    '## Détails {#details-techniques}', // 13
    'z', // 14
  ].join('\n');
  const headings = docOutline(text);

  it('nomme l’endroit par le titre au-dessus, son décalage, ou la ligne seule', () => {
    assert.equal(headingSlug('Étape 2 : déployer'), 'etape-2-deployer');
    assert.equal(lineAnchor(headings, 1), '', 'tout en haut : pas d’ancre');
    assert.equal(lineAnchor(headings, 2), 'L2', 'avant le premier titre');
    assert.equal(lineAnchor(headings, 5), 'etape-2-deployer');
    assert.equal(lineAnchor(headings, 8), 'etape-2-deployer+3');
    assert.equal(lineAnchor(headings, 7.46), 'etape-2-deployer+2.5', 'une partie de ligne');
    assert.equal(lineAnchor(headings, 9), 'installation');
    assert.equal(lineAnchor(headings, 12), 'installation-1+1', 'le deuxième titre identique est numéroté');
    assert.equal(lineAnchor(headings, 14), 'details-techniques+1', 'l’identifiant donné au titre l’emporte');
  });

  it('retrouve chaque endroit depuis son ancre, et un titre écrit à la main', () => {
    for (const line of [2, 5, 8, 7.5, 9, 12, 14]) assert.equal(anchorLine(headings, `#${lineAnchor(headings, line)}`), line, `ligne ${line}`);
    assert.equal(anchorLine(headings, '#Installation'), 9);
    assert.equal(anchorLine(headings, '#%C3%89tape%202%20%3A%20d%C3%A9ployer'), 5, 'titre encodé dans l’adresse');
    assert.equal(anchorLine(headings, '#inconnu'), null);
    assert.equal(anchorLine(headings, ''), null);
  });
});
