import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyTableAction, cellRange, cleanCell, fillRange, gridFromText, gridToMarkdown, gridToTsv, moveColumn, moveRow, parseTable, parseTsv, pasteGrid, rangeCells, serializeTable, splitRow } from '../../shared/docTable.ts';

describe('Tableaux Markdown édités cellule par cellule', () => {
  it('lit les cellules, les barres échappées et l’alignement', () => {
    assert.deepEqual(splitRow('| a | b \\| c | `d` |'), ['a', 'b \\| c', '`d`']);
    assert.deepEqual(splitRow('a | b'), ['a', 'b']);
    assert.deepEqual(splitRow('| a | |'), ['a', '']);
    const model = parseTable('| Nom | Rôle | Statut |\n| --- | :---: | ---: |\n| Alice | Dev | prêt |\n| Bob | Ops |');
    assert.deepEqual(model?.align, [null, 'center', 'right']);
    assert.deepEqual(model?.rows, [['Nom', 'Rôle', 'Statut'], ['Alice', 'Dev', 'prêt'], ['Bob', 'Ops', '']]);
    assert.equal(parseTable('Pas un tableau\n---'), null);
  });

  it('élargit le tableau plutôt que de perdre une cellule en trop', () => {
    assert.deepEqual(parseTable('| a |\n| --- |\n| 1 | 2 |')?.rows, [['a', ''], ['1', '2']]);
  });

  it('écrit des colonnes alignées, qui se relisent à l’identique', () => {
    const text = serializeTable({ align: [null, 'center', 'right'], rows: [['Nom', 'Rôle', 'Statut'], ['Alice', '**Dev**', 'prêt']] });
    assert.equal(text, '| Nom   |  Rôle   | Statut |\n| ----- | :-----: | -----: |\n| Alice | **Dev** |   prêt |');
    assert.deepEqual(parseTable(text), { align: [null, 'center', 'right'], rows: [['Nom', 'Rôle', 'Statut'], ['Alice', '**Dev**', 'prêt']] });
  });

  it('échappe les barres et garde chaque cellule sur une ligne', () => {
    assert.equal(cleanCell('a | b\nc'), 'a \\| b c');
    assert.equal(cleanCell('déjà \\| échappée'), 'déjà \\| échappée');
    assert.equal(cleanCell('||'), '\\|\\|');
  });

  it('ajoute, déplace et retire lignes et colonnes', () => {
    const model = parseTable('| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |')!;
    assert.deepEqual(applyTableAction(model, 'row-below', 1, 0)?.model.rows, [['A', 'B'], ['1', '2'], ['', ''], ['3', '4']]);
    assert.equal(applyTableAction(model, 'row-above', 0, 0), null, 'rien au-dessus de l’en-tête');
    assert.deepEqual(applyTableAction(model, 'row-down', 1, 0)?.model.rows, [['A', 'B'], ['3', '4'], ['1', '2']]);
    assert.deepEqual(applyTableAction(model, 'row-delete', 2, 1)?.focus, { row: 1, col: 1 });
    const columns = applyTableAction(model, 'col-left', 0, 1)!;
    assert.deepEqual(columns.model.rows[1], ['1', '', '2']);
    assert.deepEqual(columns.focus, { row: 0, col: 1 });
    assert.deepEqual(applyTableAction(model, 'col-move-right', 0, 0)?.model.rows[0], ['B', 'A']);
    assert.deepEqual(applyTableAction(model, 'col-delete', 0, 0)?.model.align, [null]);
    assert.equal(applyTableAction(parseTable('| A |\n| - |')!, 'col-delete', 0, 0), null, 'il reste au moins une colonne');
    assert.deepEqual(applyTableAction(model, 'align-right', 0, 1)?.model.align, [null, 'right']);
    assert.deepEqual(applyTableAction({ align: [null, 'right'], rows: model.rows }, 'align-right', 0, 1)?.model.align, [null, null], 'un second clic retire l’alignement');
    assert.deepEqual(model.rows[1], ['1', '2'], 'le tableau d’origine ne bouge pas');
  });

  describe('sélection, copier-coller et déplacements', () => {
    const base = () => parseTable('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |')!;

    it('lit un rectangle dans n’importe quel sens, et le vide', () => {
      const range = cellRange({ row: 2, col: 2 }, { row: 1, col: 1 });
      assert.deepEqual(range, { top: 1, left: 1, bottom: 2, right: 2 });
      assert.deepEqual(rangeCells(base(), range), [['2', '3'], ['5', '6']]);
      assert.deepEqual(fillRange(base(), range).rows, [['A', 'B', 'C'], ['1', '', ''], ['4', '', '']]);
    });

    it('copie au format des tableurs et en Markdown', () => {
      assert.equal(gridToTsv([['a', 'b\tc'], ['d<br>e', 'f "g"']]), 'a\t"b\tc"\n"d\ne"\t"f ""g"""');
      assert.equal(gridToMarkdown([['x', 'y']]), '| x   | y   |\n| --- | --- |\n|     |     |');
    });

    it('relit un collage d’Excel, de Google Sheets ou un tableau Markdown', () => {
      assert.deepEqual(parseTsv('a\t"b\nc"\td\r\n1\t"2 ""x"""\t3\r\n'), [['a', 'b\nc', 'd'], ['1', '2 "x"', '3']]);
      assert.deepEqual(gridFromText('| h1 | h2 |\n|---|---|\n| v1 | v2 |'), [['h1', 'h2'], ['v1', 'v2']]);
      assert.equal(gridFromText('du texte\nsur deux lignes'), null, 'texte ordinaire : une seule cellule');
    });

    it('colle une grille en agrandissant le tableau', () => {
      const { model, range } = pasteGrid(base(), { row: 2, col: 2 }, [['x', 'y'], ['z\nw', 'v']]);
      assert.deepEqual(range, { top: 2, left: 2, bottom: 3, right: 3 });
      assert.equal(model.align.length, 4);
      assert.deepEqual(model.rows, [['A', 'B', 'C', ''], ['1', '2', '3', ''], ['4', '5', 'x', 'y'], ['', '', 'z<br>w', 'v']]);
    });

    it('déplace, duplique et trie lignes et colonnes', () => {
      assert.deepEqual(moveRow(base(), 2, 1)?.rows.map((row) => row[0]), ['A', '4', '1']);
      assert.equal(moveRow(base(), 1, 0), null, 'l’en-tête reste en place');
      assert.deepEqual(moveColumn(base(), 0, 2)?.rows[0], ['B', 'C', 'A']);
      assert.deepEqual(applyTableAction(base(), 'row-duplicate', 1, 0)?.model.rows.map((row) => row[0]), ['A', '1', '1', '4']);
      assert.deepEqual(applyTableAction(base(), 'col-duplicate', 0, 1)?.model.rows[1], ['1', '2', '2', '3']);
      const sorted = applyTableAction(parseTable('| N |\n| --- |\n| 10 |\n|  |\n| 9 |')!, 'sort-asc', 0, 0)!;
      assert.deepEqual(sorted.model.rows.map((row) => row[0]), ['N', '9', '10', ''], 'nombres comparés comme des nombres, vides à la fin');
      assert.deepEqual(applyTableAction(base(), 'sort-desc', 0, 0)?.model.rows.map((row) => row[0]), ['A', '4', '1']);
    });
  });
});
