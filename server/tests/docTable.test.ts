import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyTableAction, cleanCell, parseTable, serializeTable, splitRow } from '../../shared/docTable.ts';

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
});
