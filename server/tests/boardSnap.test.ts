import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { snapMove, snapResize } from '../../shared/boardSnap.ts';

const options = { threshold: 6, grid: 8 };

describe('magnétisme du tableau blanc', () => {
  it('aligne un bord sur celui d’un voisin, avec un trait qui relie les deux', () => {
    const neighbour = { x: 100, y: 0, w: 100, h: 50 };
    const result = snapMove({ x: 0, y: 200, w: 80, h: 40 }, 97, 3, [neighbour], options);
    assert.equal(result.dx, 100, 'bords gauches alignés');
    assert.ok(result.guides.some((guide) => guide.kind === 'align' && guide.x1 === 100 && guide.x2 === 100 && guide.y1 === 0 && guide.y2 === 240), JSON.stringify(result.guides));
  });

  it('aligne les centres', () => {
    const result = snapMove({ x: 0, y: 200, w: 80, h: 40 }, 107, 0, [{ x: 100, y: 0, w: 100, h: 50 }], options);
    assert.equal(result.dx, 110, 'centre à 150, comme le voisin');
  });

  it('sans voisin à portée, la grille', () => {
    const result = snapMove({ x: 0, y: 0, w: 80, h: 40 }, 13, 21, [{ x: 500, y: 500, w: 10, h: 10 }], options);
    assert.deepEqual([result.dx, result.dy, result.guides.length], [16, 24, 0]);
    assert.deepEqual([snapMove({ x: 0, y: 0, w: 80, h: 40 }, 13, 21, [], { threshold: 6, grid: 0 }).dx], [13], 'sans grille : tel quel');
  });

  it('se cale au milieu de deux voisins, et le montre par deux écarts égaux', () => {
    const left = { x: 0, y: 0, w: 100, h: 60 };
    const right = { x: 300, y: 0, w: 100, h: 60 };
    const result = snapMove({ x: 500, y: 10, w: 80, h: 40 }, -337, 0, [left, right], options);
    assert.equal(500 + result.dx, 160);
    const gaps = result.guides.filter((guide) => guide.kind === 'gap');
    assert.deepEqual(gaps.map((guide) => guide.x2 - guide.x1), [60, 60]);
  });

  it('reprend l’écart qui sépare les deux voisins précédents', () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    const b = { x: 150, y: 0, w: 100, h: 60 };
    const result = snapMove({ x: 600, y: 0, w: 100, h: 60 }, -297, 0, [a, b], options);
    assert.equal(600 + result.dx, 300, 'même écart de 50');
    assert.deepEqual(result.guides.filter((guide) => guide.kind === 'gap').map((guide) => [guide.x1, guide.x2]), [[100, 150], [250, 300]]);
  });

  it('cherche les voisins en face de là où le pointeur amène la boîte, sur les deux axes', () => {
    const result = snapMove({ x: 0, y: 260, w: 200, h: 90 }, 603, -257, [{ x: 0, y: 0, w: 200, h: 90 }, { x: 300, y: 0, w: 200, h: 90 }], options);
    assert.deepEqual([result.dx, result.dy], [600, -260]);
    assert.deepEqual(result.guides.filter((guide) => guide.kind === 'gap').map((guide) => [guide.x1, guide.x2]), [[200, 300], [500, 600]]);
  });

  it('un voisin qui n’est pas en face ne compte pas pour les écarts', () => {
    const result = snapMove({ x: 600, y: 500, w: 100, h: 60 }, -297, 0, [{ x: 0, y: 0, w: 100, h: 60 }, { x: 150, y: 0, w: 100, h: 60 }], options);
    assert.equal(result.guides.filter((guide) => guide.kind === 'gap').length, 0);
  });

  it('redimensionne jusqu’au bord d’un voisin, sans descendre sous la taille minimale', () => {
    const neighbour = { x: 300, y: 0, w: 100, h: 100 };
    const east = snapResize({ x: 0, y: 0, w: 297, h: 50 }, 'e', [neighbour], { ...options, min: 24 });
    assert.deepEqual([east.rect.x, east.rect.w], [0, 300]);
    assert.ok(east.guides.some((guide) => guide.x1 === 300 && guide.x2 === 300));
    const west = snapResize({ x: 403, y: 0, w: 197, h: 50 }, 'w', [neighbour], { ...options, min: 24 });
    assert.deepEqual([west.rect.x, west.rect.x + west.rect.w], [400, 600], 'le bord droit ne bouge pas');
    const tiny = snapResize({ x: 290, y: 0, w: 15, h: 50 }, 'e', [{ x: 300, y: 0, w: 10, h: 10 }], { ...options, min: 24 });
    assert.ok(tiny.rect.w !== 10, 'jamais plus petit que le minimum');
  });
});
