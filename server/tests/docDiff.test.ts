import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedPassage, composeMerge, defaultPick, diffParts, hunkRows, mergedText, normalizeEol, pickedText, replacePassage, wordDiff, type DiffHunk, type DiffPart } from '../../shared/docDiff.ts';
import { docOutline } from '../../shared/docOutline.ts';

const hunksOf = (parts: DiffPart[]): DiffHunk[] => parts.flatMap((part) => (part.type === 'hunk' ? [part.hunk] : []));

describe('comparaison de deux versions', () => {
  it('distingue ce qui est ajouté, retiré ou changé', () => {
    const parts = diffParts('un\ndeux\ntrois\nquatre', 'un\ndeux bis\ntrois\nquatre\ncinq');
    const hunks = hunksOf(parts);
    assert.deepEqual(hunks.map((hunk) => hunk.kind), ['changed', 'added']);
    assert.deepEqual(hunks[1]!.right, ['cinq']);
    assert.deepEqual(hunksOf(diffParts('un\ndeux', 'un')).map((hunk) => hunk.kind), ['removed']);
  });

  it('traite un texte vide comme aucune ligne', () => {
    assert.deepEqual(hunksOf(diffParts('', 'un\ndeux')).map((hunk) => [hunk.kind, hunk.right.length]), [['added', 2]]);
    assert.deepEqual(diffParts('', ''), []);
    assert.deepEqual(diffParts('même', 'même').map((part) => part.type), ['same']);
  });

  it('dit qui a changé chaque bloc quand l’origine est connue', () => {
    const base = 'a\nb\nc\nd\ne\nf\ng';
    const left = 'a\nB\nc\nd\ne\nf\ng';
    const right = 'a\nb\nc\nd\nE\nf\ng';
    assert.deepEqual(hunksOf(diffParts(left, right, base)).map((hunk) => hunk.origin), ['left', 'right']);
    assert.deepEqual(hunksOf(diffParts('a\nX\nc', 'a\nY\nc', 'a\nb\nc')).map((hunk) => hunk.origin), ['both'], 'les deux ont changé la même ligne');
    assert.deepEqual(hunksOf(diffParts('a\nX', 'a\nY')).map((hunk) => hunk.origin), ['both'], 'sans origine, rien ne départage');
    assert.deepEqual(hunksOf(diffParts('a\nc\nd\ne', 'a\nb\nc\nd\ne', 'a\nb\nc\nd\ne')).map((hunk) => [hunk.kind, hunk.origin]), [['added', 'left']], 'une suppression de A se lit comme un ajout de B, mais vient de A');
  });

  it('compose le résultat selon les choix, sans ligne vide à la place d’un bloc retiré', () => {
    const parts = diffParts('titre\nancien\nfin', 'titre\nnouveau\nfin');
    const hunk = hunksOf(parts)[0]!;
    const compose = (left: boolean, right: boolean) => mergedText(composeMerge(parts, [{ left, right, decided: true }]).doc);
    assert.equal(compose(true, false), 'titre\nancien\nfin');
    assert.equal(compose(false, true), 'titre\nnouveau\nfin');
    assert.equal(compose(true, true), 'titre\nancien\nnouveau\nfin');
    assert.equal(compose(false, false), 'titre\nfin');
    const { doc, ranges } = composeMerge(parts, [{ left: false, right: true, decided: true }]);
    assert.equal(doc.slice(ranges[0]!.from, ranges[0]!.to), pickedText(hunk, { left: false, right: true, decided: true }));
  });

  it('garde la fin de ligne finale de chaque version', () => {
    const parts = diffParts('un\n', 'un\ndeux\n');
    assert.equal(mergedText(composeMerge(parts, hunksOf(parts).map((hunk) => defaultPick(hunk, 'right'))).doc), 'un\ndeux\n');
    assert.equal(mergedText(composeMerge(parts, hunksOf(parts).map((hunk) => defaultPick(hunk, 'left'))).doc), 'un\n');
  });

  it('choisit d’office le côté qui a changé, et laisse les vrais conflits à trancher', () => {
    const [left, right, both] = [{ origin: 'left' }, { origin: 'right' }, { origin: 'both' }] as DiffHunk[];
    assert.deepEqual(defaultPick(left!), { left: true, right: false, decided: true });
    assert.deepEqual(defaultPick(right!), { left: false, right: true, decided: true });
    assert.deepEqual(defaultPick(both!), { left: false, right: false, decided: false });
    assert.deepEqual(defaultPick(both!, 'right'), { left: false, right: true, decided: true }, 'dans l’historique, le texte actuel reste la référence');
  });

  it('met en avant les mots qui changent, et la ligne entière si tout change', () => {
    const { left, right } = wordDiff('Installer le serveur de test', 'Installer le serveur de production');
    assert.deepEqual(left.filter((span) => span.changed).map((span) => span.text), ['test']);
    assert.deepEqual(right.filter((span) => span.changed).map((span) => span.text), ['production']);
    assert.deepEqual(wordDiff('aaa bbb', 'xxx yyy').left, [{ text: 'aaa bbb', changed: true }]);
  });

  it('aligne les lignes d’un bloc, avec un vide en face de ce qui manque', () => {
    const hunk = hunksOf(diffParts('a\nb\nc', 'a\nB\nC\nD\nc'))[0]!;
    const rows = hunkRows(hunk);
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.leftLine, 2);
    assert.equal(rows[2]!.left, null);
    assert.equal(rows[2]!.rightLine, 4);
  });

  it('retire les fins de ligne Windows et la marque d’encodage', () => {
    assert.equal(normalizeEol('﻿un\r\ndeux\rtrois\n'), 'un\ndeux\ntrois\n');
  });
});

describe('passage modifié par l’assistant', () => {
  it('garde des lignes entières et assez de contexte pour rejouer ou annuler', () => {
    const before = 'titre\n\nligne\nune phrase à corriger\nligne\n\nfin';
    const after = before.replace('à corriger', 'corrigée');
    const passage = changedPassage(before, after);
    assert.ok(passage.before.includes('une phrase à corriger'));
    assert.ok(passage.before.length < before.length, 'pas toute la note');
    assert.equal(replacePassage(before, passage.before, passage.after), after);
    assert.equal(replacePassage(after, passage.after, passage.before), before);
  });

  it('survit à ce qui est écrit ailleurs dans la note', () => {
    const before = 'un\ndeux\ntrois\nquatre\ncinq\nsix\nsept';
    const after = before.replace('quatre', 'QUATRE');
    const passage = changedPassage(before, after);
    assert.equal(replacePassage(`avant\n${before}\naprès`, passage.before, passage.after), `avant\n${after}\naprès`);
  });

  it('s’élargit tant que le passage n’est pas unique', () => {
    const before = 'x\nx\nx\nA\nx\nx\nB\nx';
    const after = before.replace('A', 'Z');
    const passage = changedPassage(before, after);
    assert.equal(replacePassage(before, passage.before, passage.after), after);
  });

  it('gère une note vide, ou vidée', () => {
    const created = changedPassage('', 'nouveau');
    assert.equal(replacePassage('', created.before, created.after), 'nouveau');
    const emptied = changedPassage('tout', '');
    assert.equal(replacePassage('tout', emptied.before, emptied.after), '');
  });

  it('refuse un passage disparu ou devenu ambigu', () => {
    assert.equal(replacePassage('un deux', 'trois', 'x'), null);
    assert.equal(replacePassage('un un', 'un', 'x'), null);
    assert.equal(replacePassage('du texte', '', 'x'), null);
  });
});

describe('sommaire d’une note', () => {
  it('lit les titres et sous-titres, avec leur niveau et leur ligne', () => {
    assert.deepEqual(docOutline('# Un\ntexte\n\n## Deux\n### Trois ###'), [
      { level: 1, title: 'Un', line: 1 },
      { level: 2, title: 'Deux', line: 4 },
      { level: 3, title: 'Trois', line: 5 },
    ]);
  });

  it('ignore le code et ce qui ne fait que ressembler à un titre', () => {
    assert.deepEqual(docOutline('```bash\n# commentaire\n```\n#pas un titre\n~~~\n## non plus\n~~~\n# Vrai').map((heading) => heading.title), ['Vrai']);
  });

  it('accepte les titres soulignés, sans confondre un filet ou un tableau', () => {
    assert.deepEqual(docOutline('Grand\n=====\n\nPetit\n---\n\n---\n\n| a |\n|---|\n\n- liste\n---').map((heading) => [heading.level, heading.title, heading.line]), [
      [1, 'Grand', 1],
      [2, 'Petit', 4],
    ]);
  });

  it('montre le titre tel qu’on le lit', () => {
    assert.deepEqual(docOutline('## **Gras** et `code`\n## [Lien](https://a.fr) et [[Note|Alias]]\n## @[Léa](user:3)').map((heading) => heading.title), ['Gras et code', 'Lien et Alias', 'Léa']);
  });

  it('écarte un titre vide', () => {
    assert.deepEqual(docOutline('#\n## \n'), []);
  });
});
