import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldKeyOf, hiddenByFolds, sourceHeading } from '../../shared/docFolds.ts';
import { headingKey } from '../../shared/docLinks.ts';

describe('replier les titres de la documentation', () => {
  it('reconnaît les titres du source, comme la lecture les nomme', () => {
    assert.deepEqual(sourceHeading('## Mise en route'), { depth: 2, normalized: 'mise en route' });
    assert.deepEqual(sourceHeading('###### Détail  ###'), { depth: 6, normalized: 'détail' });
    assert.deepEqual(sourceHeading('# Installer {#install}'), { depth: 1, normalized: headingKey('Installer') });
    assert.equal(sourceHeading('#hashtag'), null, 'une étiquette n’est pas un titre');
    assert.equal(sourceHeading('Texte # pas un titre'), null);
    assert.equal(sourceHeading('####### sept'), null);
  });

  it('distingue les titres identiques par leur rang', () => {
    const seen = new Map<string, number>();
    assert.deepEqual([foldKeyOf(2, 'notes', seen), foldKeyOf(3, 'notes', seen), foldKeyOf(2, 'notes', seen)], ['2|notes|0', '3|notes|0', '2|notes|1']);
  });

  it('cache la section jusqu’au titre de même niveau ou plus haut', () => {
    const blocks = [
      { depth: 1, key: 'a' }, // # A (replié)
      { depth: null }, //   texte
      { depth: 2, key: 'b' }, //   ## B (replié lui aussi)
      { depth: null }, //     texte
      { depth: 1, key: 'c' }, // # C
      { depth: null }, //   texte
      { depth: 2, key: 'd' }, //   ## D (replié)
      { depth: null }, //     texte
      { depth: 3, key: 'e' }, //     ### E
      { depth: 2, key: 'f' }, //   ## F
    ];
    assert.deepEqual(hiddenByFolds(blocks, new Set(['a', 'b', 'd'])), [false, true, true, true, false, false, false, true, true, false]);
    assert.deepEqual(hiddenByFolds(blocks, new Set(['b'])), [false, false, false, true, false, false, false, false, false, false]);
    assert.deepEqual(hiddenByFolds(blocks, new Set()), blocks.map(() => false));
  });
});
