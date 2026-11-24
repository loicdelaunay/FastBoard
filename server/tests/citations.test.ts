import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { numberLines, withoutLineNumbers } from '../../shared/ai.ts';
import { boardMentionView, MENTION_VIEW_SUFFIX } from '../../shared/boards.ts';
import { citedElementsFromQuery, citedElementsOf, citedLinesFromQuery, citedLinesOf, lineCited, linesLabel, linesParam } from '../../shared/citations.ts';
import { plainText } from '../../shared/docComments.ts';
import { extractDocLinks } from '../../shared/docLinks.ts';

describe('citations', () => {
  it('lit les lignes citées d’une note, triées et fusionnées', () => {
    assert.deepEqual(citedLinesOf('L12'), [{ from: 12, to: 12 }]);
    assert.deepEqual(citedLinesOf('L12-18'), [{ from: 12, to: 18 }]);
    assert.deepEqual(citedLinesOf('L18-12'), [{ from: 12, to: 18 }], 'à l’envers : remis dans l’ordre');
    assert.deepEqual(citedLinesOf('L12-L18'), [{ from: 12, to: 18 }]);
    assert.deepEqual(citedLinesOf('L9,3-5,4-6,10'), [{ from: 3, to: 6 }, { from: 9, to: 10 }], 'plages qui se touchent : fusionnées');
    for (const wrong of ['', 'L', 'L0', 'Lx', 'L3-', 'image', 'el:a1', 'L1,,2']) assert.equal(citedLinesOf(wrong), null, wrong);
    assert.equal(citedLinesOf(null), null);
    assert.deepEqual(citedLinesFromQuery('4-9,15'), [{ from: 4, to: 9 }, { from: 15, to: 15 }]);
    assert.equal(citedLinesFromQuery(['4-9']), null, 'une seule valeur');

    const ranges = citedLinesOf('L3-5,9')!;
    assert.equal(linesParam(ranges), '3-5,9');
    assert.equal(linesLabel(ranges), '3–5, 9');
    assert.ok(lineCited(ranges, 4) && lineCited(ranges, 9) && !lineCited(ranges, 6));
  });

  it('lit les éléments cités d’un tableau', () => {
    assert.deepEqual(citedElementsOf('el:a1b2c3,d4e5f6'), ['a1b2c3', 'd4e5f6']);
    assert.deepEqual(citedElementsOf('el:a1,a1, b2'), ['a1', 'b2'], 'sans doublons');
    assert.equal(citedElementsOf('el:'), null);
    assert.equal(citedElementsOf('el:a<b'), null);
    assert.equal(citedElementsOf('image'), null);
    assert.deepEqual(citedElementsFromQuery('x1,y2'), ['x1', 'y2']);
  });

  it('numérote ce que lit l’assistant, et retire les numéros recopiés', () => {
    assert.equal(numberLines('a\n\nb', 7), '7│ a\n8│ \n9│ b');
    assert.equal(withoutLineNumbers('7│ a\n8│ \n9│ b'), 'a\n\nb');
    assert.equal(withoutLineNumbers('  12│ texte'), 'texte');
    assert.equal(withoutLineNumbers('a\n2│ b'), 'a\n2│ b', 'une ligne sans numéro : le texte est gardé tel quel');
    assert.equal(withoutLineNumbers('Version 2 │ bêta'), 'Version 2 │ bêta');
    assert.equal(withoutLineNumbers(''), '');
  });

  it('garde les mentions avec un suffixe comprises partout', () => {
    const suffix = new RegExp(`^@\\[x\\]\\(doc:1${MENTION_VIEW_SUFFIX}\\)$`);
    for (const value of ['@[x](doc:1)', '@[x](doc:1#L3-5,9)', '@[x](doc:1#el:a1b2c3,d4)', '@[x](doc:1#image)']) assert.match(value, suffix);
    assert.equal(boardMentionView('el:a1'), null, 'des éléments cités ne sont pas un affichage');

    // Rétroliens : une note citée par ses lignes, un tableau par ses éléments, restent des liens.
    const links = extractDocLinks('Voir @[Guide](doc:12#L4-9) et @[Schéma](board:7#el:a1b2c3), puis @[Projet](project:3).');
    assert.deepEqual([links.docs, links.boards, links.paths], [[12], [7], []]);
    assert.equal(plainText('Voir @[Guide](doc:12#L4-9) et @[Boutique](project:3).', true), 'Voir Guide et Boutique.');
  });
});
