import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contains, intersects } from '../../shared/boardGeometry.ts';
import type { BoardElement, ConnectorElement, FrameElement, MindElement, PlacedElement, ShapeElement } from '../../shared/boards.ts';
import { exportMermaid, layoutGraph, MermaidError, mermaidToElements, parseMermaid, type MermaidGraph } from '../../shared/boardMermaid.ts';

const shape = (id: string, text: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement => ({
  id,
  type: 'shape',
  z: 1,
  x,
  y,
  w: 120,
  h: 56,
  shape: 'rect',
  text,
  color: 'default',
  fill: 'solid',
  size: 'm',
  ...extra,
});

const link = (id: string, from: string | null, to: string | null, extra: Partial<ConnectorElement> = {}): ConnectorElement => ({
  id,
  type: 'connector',
  z: 5,
  from: { id: from, side: null, x: 0, y: 0 },
  to: { id: to, side: null, x: 0, y: 0 },
  label: '',
  route: 'elbow',
  dashed: false,
  arrowStart: false,
  arrowEnd: true,
  color: 'default',
  ...extra,
});

const mind = (id: string, text: string, parent: string | null, x: number, y: number): MindElement => ({
  id,
  type: 'mind',
  z: 1,
  x,
  y,
  w: 120,
  h: 40,
  text,
  color: 'default',
  parent,
  direction: 'right',
});

/** Liens lus, avec les libellés des nœuds : `A --> B`, `A -.<> B [texte]`… */
function edgesOf(graph: MermaidGraph): string[] {
  const label = new Map(graph.nodes.map((node) => [node.id, node.label]));
  return graph.edges.map((edge) => {
    const arrow = `${edge.dashed ? '-.' : '--'}${edge.arrowStart ? '<' : ''}${edge.arrowEnd ? '>' : ''}`;
    return `${label.get(edge.from) ?? edge.from} ${arrow} ${label.get(edge.to) ?? edge.to}${edge.label ? ` [${edge.label}]` : ''}`;
  });
}

const nodesOf = (graph: MermaidGraph): Record<string, [string, string]> => Object.fromEntries(graph.nodes.map((node) => [node.id, [node.label, node.shape]]));

const counter = (): (() => string) => {
  let next = 0;
  return () => `e${(next += 1)}`;
};

describe('Import Mermaid : organigrammes', () => {
  it('lit toutes les formes de nœuds', () => {
    const graph = parseMermaid(
      [
        'flowchart LR',
        '  A[Rect] --> B(Arrondi) --> C([Stade]) --> D[[Sous-routine]] --> E[(Base)]',
        '  F((Cercle)) --> G(((Double))) --> H>Drapeau] --> I{Choix ?} --> J{{Hexa}}',
        '  K[/Para/] --> L[\\Para\\] --> M[/Trap\\] --> N[\\Inv/]',
        '  O --> P["Guillemets #quot;x#quot; [ok] #amp; (b)"] --> Q["`**md**`"] --> R["un<br>deux<br/>trois"]',
        '  S@{ shape: diamond, label: "Décision" } --> T@{ shape: cyl } --> U@{ shape: inconnue, label: \'x\' } --> V@{ shape: hex }',
        '  W@{ shape: lean-r } --> X@{ shape: tri } --> Y@{ shape: circle } --> Z@{ shape: rounded }',
        '  Café_1.v2-b --> O',
      ].join('\n'),
    );
    assert.equal(graph.kind, 'flowchart');
    assert.equal(graph.direction, 'LR');
    assert.deepEqual(nodesOf(graph), {
      A: ['Rect', 'rect'],
      B: ['Arrondi', 'rounded'],
      C: ['Stade', 'rounded'],
      D: ['Sous-routine', 'rect'],
      E: ['Base', 'cylinder'],
      F: ['Cercle', 'ellipse'],
      G: ['Double', 'ellipse'],
      H: ['Drapeau', 'parallelogram'],
      I: ['Choix ?', 'diamond'],
      J: ['Hexa', 'hexagon'],
      K: ['Para', 'parallelogram'],
      L: ['Para', 'parallelogram'],
      M: ['Trap', 'parallelogram'],
      N: ['Inv', 'parallelogram'],
      O: ['O', 'rect'],
      P: ['Guillemets "x" [ok] & (b)', 'rect'],
      Q: ['**md**', 'rect'],
      R: ['un\ndeux\ntrois', 'rect'],
      S: ['Décision', 'diamond'],
      T: ['T', 'cylinder'],
      U: ['x', 'rect'],
      V: ['V', 'hexagon'],
      W: ['W', 'parallelogram'],
      X: ['X', 'triangle'],
      Y: ['Y', 'ellipse'],
      Z: ['Z', 'rounded'],
      'Café_1.v2-b': ['Café_1.v2-b', 'rect'],
    });
    assert.equal(graph.edges.length, 21);
  });

  it('garde la première définition d’un nœud entre crochets', () => {
    const graph = parseMermaid('graph TD\n  A --> B[Deux]\n  B(Autre)\n  A{Un}\n  A[Encore]');
    assert.deepEqual(nodesOf(graph), { A: ['Un', 'diamond'], B: ['Deux', 'rect'] });
    assert.equal(graph.direction, 'TB');
  });

  it('suit les chaînes et les esperluettes', () => {
    const graph = parseMermaid('flowchart TD\n  A --> B --> C\n  D & E --> F & G\n  H-->I & J-->K');
    assert.deepEqual(edgesOf(graph), [
      'A --> B',
      'B --> C',
      'D --> F',
      'D --> G',
      'E --> F',
      'E --> G',
      'H --> I',
      'H --> J',
      'I --> K',
      'J --> K',
    ]);
  });

  it('lit les quatre formes d’étiquettes de lien', () => {
    const graph = parseMermaid(
      ['flowchart LR', '  A -->|oui| B', '  A -- non merci --> C', '  A -. peut-être .-> D', '  A == sûr ==> E', '  A -->|"avec | barre"| F', '  A---|lien|G'].join('\n'),
    );
    assert.deepEqual(edgesOf(graph), ['A --> B [oui]', 'A --> C [non merci]', 'A -.> D [peut-être]', 'A --> E [sûr]', 'A --> F [avec | barre]', 'A -- G [lien]']);
  });

  it('distingue liens pointillés, épais et à double flèche', () => {
    const graph = parseMermaid(
      [
        'flowchart LR',
        '  A --> B',
        '  A --- C',
        '  A -.-> D',
        '  A -.- E',
        '  A ==> F',
        '  A === G',
        '  A --o H',
        '  A --x I',
        '  A <--> J',
        '  A <-.-> K',
        '  L o--o M',
        '  N x--x O',
        '  A ---> P',
        '  A -..-> Q',
        '  A ====> R',
        '  A ~~~ S',
        '  A e1@--> T',
        '  e1@{ animate: true }',
      ].join('\n'),
    );
    assert.deepEqual(edgesOf(graph), [
      'A --> B',
      'A -- C',
      'A -.> D',
      'A -. E',
      'A --> F',
      'A -- G',
      'A --> H',
      'A --> I',
      'A --<> J',
      'A -.<> K',
      'L --<> M',
      'N --<> O',
      'A --> P',
      'A -.> Q',
      'A --> R',
      'A --> T',
    ]);
    assert.ok(graph.nodes.some((node) => node.id === 'S'), 'un lien invisible garde ses nœuds');
    assert.ok(!graph.nodes.some((node) => node.id === 'e1'), 'un identifiant de lien n’est pas un nœud');
  });

  it('ignore commentaires, styles et lignes illisibles', () => {
    const graph = parseMermaid(
      [
        '%%{init: {"theme": "dark"}}%%',
        'flowchart TD',
        '  %% un commentaire',
        '  A --> B %% en fin de ligne',
        '  classDef rouge fill:#f00',
        '  class A rouge',
        '  style B fill:#f9f,stroke:#333',
        '  linkStyle 0 stroke:red',
        '  click A "https://example.com"',
        '  accTitle: Titre',
        '  accDescr: Description',
        '  accDescr {',
        '    sur plusieurs; lignes',
        '  }',
        '  ceci n’est pas lisible ((',
        '  C:::rouge --> D;E --> F',
      ].join('\n'),
    );
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ['A', 'B', 'C', 'D', 'E', 'F'],
    );
    assert.deepEqual(edgesOf(graph), ['A --> B', 'C --> D', 'E --> F']);
  });

  it('lit les sous-graphes, imbriqués ou non, et les liens vers un sous-graphe', () => {
    const graph = parseMermaid(
      [
        'flowchart TB',
        '  c1 --> a2',
        '  subgraph one [Un]',
        '    a1 --> a2',
        '    subgraph inner["Intérieur"]',
        '      direction LR',
        '      b1',
        '    end',
        '  end',
        '  subgraph "Deux mots"',
        '    c2',
        '  end',
        '  subgraph three',
        '    d1',
        '  end',
        '  one --> c2',
      ].join('\n'),
    );
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ['c1', 'a2', 'a1', 'b1', 'c2', 'd1'],
    );
    assert.deepEqual(graph.groups, [
      { id: 'one', label: 'Un', nodes: ['a2', 'a1', 'b1'] },
      { id: 'inner', label: 'Intérieur', nodes: ['b1'] },
      { id: 'subGraph3', label: 'Deux mots', nodes: ['c2'] },
      { id: 'three', label: 'three', nodes: ['d1'] },
    ]);
    assert.deepEqual(edgesOf(graph), ['c1 --> a2', 'a1 --> a2', 'one --> c2']);
  });

  it('accepte un bloc de code et un en-tête YAML', () => {
    const text = 'Voici le schéma :\n\n```mermaid\n---\ntitle: Exemple\n---\ngraph LR;\n  A-->B\n```\n\nBonne lecture.';
    const graph = parseMermaid(text);
    assert.equal(graph.direction, 'LR');
    assert.deepEqual(edgesOf(graph), ['A --> B']);
    assert.deepEqual(edgesOf(parseMermaid('\n\n```\nflowchart RL\nX --> Y\n```\n\n')), ['X --> Y']);
    assert.equal(parseMermaid('\n\n  flowchart BT\n  A\n\n').direction, 'BT');
  });

  it('refuse les diagrammes non pris en charge et les textes sans nœud', () => {
    for (const text of ['sequenceDiagram\n  A->>B: Bonjour', 'classDiagram\n  Animal <|-- Chien', 'A --> B', 'pie\n  "a" : 1']) {
      assert.throws(() => parseMermaid(text), MermaidError, text);
    }
    assert.throws(() => parseMermaid(''), { message: 'Texte Mermaid vide.' });
    assert.throws(() => parseMermaid('```mermaid\n\n```'), { message: 'Texte Mermaid vide.' });
    assert.throws(() => parseMermaid('flowchart TD\n  ((( )))\n  %% rien'), { message: 'Aucun nœud lisible dans ce diagramme Mermaid.' });
    assert.throws(() => parseMermaid('mindmap\n'), MermaidError);
  });
});

describe('Import Mermaid : cartes mentales', () => {
  const text = [
    'mindmap',
    '  root((Projet))',
    '    Objectifs',
    '      ::icon(fa fa-bullseye)',
    '      Délais',
    '      Budget:::urgent',
    '    id2[Équipe]',
    '      (Dev)',
    '      ))Ops((',
    '      {{Qualité}}',
    '    Risques',
  ].join('\n');

  it('lit l’arbre d’après l’indentation', () => {
    const graph = parseMermaid(text);
    assert.equal(graph.kind, 'mindmap');
    assert.equal(graph.direction, 'LR');
    assert.deepEqual(
      graph.nodes.map((node) => [node.label, node.shape]),
      [
        ['Projet', 'ellipse'],
        ['Objectifs', 'rounded'],
        ['Délais', 'rounded'],
        ['Budget', 'rounded'],
        ['Équipe', 'rect'],
        ['Dev', 'rounded'],
        ['Ops', 'ellipse'],
        ['Qualité', 'hexagon'],
        ['Risques', 'rounded'],
      ],
    );
    assert.deepEqual(edgesOf(graph), [
      'Projet -- Objectifs',
      'Objectifs -- Délais',
      'Objectifs -- Budget',
      'Projet -- Équipe',
      'Équipe -- Dev',
      'Équipe -- Ops',
      'Équipe -- Qualité',
      'Projet -- Risques',
    ]);
  });

  it('crée des nœuds de carte mentale disposés à droite de leur parent', () => {
    const elements = mermaidToElements(text, { x: 500, y: 300 }, { idFactory: counter(), zStart: 10 });
    assert.ok(elements.every((element) => element.type === 'mind'));
    const nodes = elements as MindElement[];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    assert.equal(nodes[0]!.parent, null);
    assert.equal(nodes[0]!.text, 'Projet');
    assert.deepEqual(
      nodes.map((node) => node.z),
      [10, 11, 12, 13, 14, 15, 16, 17, 18],
    );
    for (const node of nodes.slice(1)) {
      const parent = byId.get(node.parent!)!;
      assert.ok(node.x >= parent.x + parent.w, `${node.text} à droite de ${parent.text}`);
    }
    for (let a = 0; a < nodes.length; a += 1) for (let b = a + 1; b < nodes.length; b += 1) assert.ok(!intersects(nodes[a]!, nodes[b]!));
    assert.equal(Math.min(...nodes.map((node) => node.x)), 500);
    assert.equal(Math.min(...nodes.map((node) => node.y)), 300);
  });

  it('exporte une carte mentale seule en mindmap, qui se relit à l’identique', () => {
    const elements = mermaidToElements(text, { x: 0, y: 0 }, { idFactory: counter() });
    const output = exportMermaid(elements);
    assert.ok(output.startsWith('mindmap\n  root((Projet))\n    Objectifs\n      Délais\n      Budget\n    Équipe\n'), output);
    const back = parseMermaid(output);
    assert.deepEqual(edgesOf(back), edgesOf(parseMermaid(text)));
    const odd = exportMermaid([mind('r', 'f(x) = "2"', null, 0, 0), mind('c', 'a::b', 'r', 200, 0), mind('d', 'Simple', 'r', 200, 60)]);
    assert.equal(odd, 'mindmap\n  root(("f(x) = #quot;2#quot;"))\n    ["a::b"]\n    Simple');
    assert.deepEqual(
      parseMermaid(odd).nodes.map((node) => node.label),
      ['f(x) = "2"', 'a::b', 'Simple'],
    );
  });
});

describe('Export Mermaid', () => {
  const elements: BoardElement[] = [
    shape('s1', 'Début', 0, 0),
    shape('s2', 'Choix "rapide"', 0, 140, { shape: 'diamond' }),
    { id: 'p1', type: 'sticky', z: 1, x: 200, y: 140, w: 120, h: 56, text: 'Note\nlongue', color: 'yellow', votes: [] },
    { id: 't1', type: 'text', z: 1, x: 400, y: 140, w: 120, h: 56, text: 'Texte', color: 'default', size: 'm', align: 'left' },
    { id: 'f1', type: 'fast', z: 1, x: 0, y: 300, w: 120, h: 56, ref: { kind: 'ticket', id: 12 }, label: 'Ticket FB-12' },
    mind('m1', 'Idée', null, 200, 300),
    mind('m2', 'Branche', 'm1', 400, 300),
    { id: 'fr', type: 'frame', z: 0, x: -20, y: 100, w: 600, h: 140, title: 'Section', color: 'default' },
    { id: 'pa', type: 'path', z: 1, x: 0, y: 0, w: 10, h: 10, points: [0, 0, 10, 10], color: 'default', width: 3, highlighter: false },
    link('c1', 's1', 's2', { label: 'go | now' }),
    link('c2', 's2', 'p1', { dashed: true, arrowStart: true }),
    link('c3', 'p1', 't1', { arrowStart: true, arrowEnd: false }),
    link('c4', 's1', 'f1', { arrowEnd: false }),
    link('c5', 's1', null),
    link('c6', 's1', 'pa'),
  ];

  it('écrit nœuds, sections et liens, et se relit à l’identique', () => {
    const output = exportMermaid(elements);
    assert.equal(
      output,
      [
        'flowchart LR',
        '    n1["Début"]',
        '    subgraph g1 ["Section"]',
        '        n2{"Choix #quot;rapide#quot;"}',
        '        n3["Note<br>longue"]',
        '        n4["Texte"]',
        '    end',
        '    n5["Ticket FB-12"]',
        '    n6["Idée"]',
        '    n7["Branche"]',
        '    n1 -->|go / now| n2',
        '    n1 --- n5',
        '    n2 <-.-> n3',
        '    n4 --> n3',
        '    n6 --- n7',
      ].join('\n'),
    );
    const back = parseMermaid(output);
    assert.deepEqual(
      back.nodes.map((node) => [node.label, node.shape]),
      [
        ['Début', 'rect'],
        ['Choix "rapide"', 'diamond'],
        ['Note\nlongue', 'rect'],
        ['Texte', 'rect'],
        ['Ticket FB-12', 'rect'],
        ['Idée', 'rect'],
        ['Branche', 'rect'],
      ],
    );
    assert.deepEqual(edgesOf(back), ['Début --> Choix "rapide" [go / now]', 'Début -- Ticket FB-12', 'Choix "rapide" -.<> Note\nlongue', 'Texte --> Note\nlongue', 'Idée -- Branche']);
    assert.deepEqual(back.groups, [{ id: 'g1', label: 'Section', nodes: ['n2', 'n3', 'n4'] }]);
  });

  it('se limite aux éléments choisis', () => {
    assert.equal(exportMermaid(elements, new Set(['s1', 's2', 'c1', 'c4'])), 'flowchart TD\n    n1["Début"]\n    n2{"Choix #quot;rapide#quot;"}\n    n1 -->|go / now| n2');
    assert.equal(exportMermaid(elements, new Set(['fr', 'pa', 'c1'])), '');
    assert.equal(exportMermaid([]), '');
  });

  it('écrit des formes, des étiquettes et des sections qui se relisent', () => {
    const kinds = ['rect', 'rounded', 'ellipse', 'diamond', 'parallelogram', 'hexagon', 'cylinder', 'triangle'] as const;
    const shapes = kinds.map((kind, index) => shape(`k${index}`, `Forme ${kind}`, index * 200, 0, { shape: kind }));
    const output = exportMermaid([
      ...shapes,
      link('l1', 'k0', 'k1', { label: 'a (b) [c]' }),
      link('l2', 'k1', 'k2', { label: 'deux\nlignes' }),
      { id: 'outer', type: 'frame', z: 0, x: -50, y: -100, w: 1000, h: 300, title: 'Dehors', color: 'default' },
      { id: 'inner', type: 'frame', z: 0, x: -20, y: -50, w: 400, h: 150, title: '', color: 'default' },
      link('l3', 'inner', 'k7'),
    ]);
    const back = parseMermaid(output);
    assert.deepEqual(
      back.nodes.map((node) => [node.id, node.label, node.shape]),
      kinds.map((kind, index) => [`n${index + 1}`, `Forme ${kind}`, kind === 'triangle' ? 'rect' : kind]),
    );
    assert.deepEqual(
      back.edges.map((edge) => edge.label),
      ['a (b) [c]', 'deux\nlignes', ''],
    );
    assert.deepEqual(back.groups, [
      { id: 'g1', label: 'Dehors', nodes: ['n1', 'n2', 'n3', 'n4', 'n5'] },
      { id: 'g2', label: '', nodes: ['n1', 'n2'] },
    ]);
    assert.deepEqual(
      back.edges.map((edge) => [edge.from, edge.to]),
      [
        ['n1', 'n2'],
        ['n2', 'n3'],
        ['g2', 'n8'],
      ],
    );
  });

  it('choisit LR ou TD selon la disposition', () => {
    const row = [shape('a', 'A', 0, 0), shape('b', 'B', 300, 20), link('l', 'a', 'b')];
    const column = [shape('a', 'A', 0, 0), shape('b', 'B', 20, 300), link('l', 'a', 'b')];
    assert.ok(exportMermaid(row).startsWith('flowchart LR\n'));
    assert.ok(exportMermaid(column).startsWith('flowchart TD\n'));
    assert.ok(exportMermaid([shape('a', 'A', 0, 0), shape('b', 'B', 400, 100)]).startsWith('flowchart LR\n'), 'sans lien : plus large que haut');
    assert.ok(exportMermaid([shape('a', 'A', 0, 0), shape('b', 'B', 100, 400)]).startsWith('flowchart TD\n'), 'sans lien : plus haut que large');
  });

  it('numérote les nœuds dans l’ordre de lecture', () => {
    const output = exportMermaid([shape('c', 'C', 0, 200), shape('b', 'B', 300, 4), shape('a', 'A', 0, 0, { h: 80 })]);
    assert.equal(output, 'flowchart LR\n    n1["A"]\n    n2["B"]\n    n3["C"]');
  });
});

describe('Disposition des graphes importés', () => {
  const sized = (graph: MermaidGraph): Map<string, { w: number; h: number }> =>
    new Map(graph.nodes.map((node, index) => [node.id, { w: 100 + (index % 3) * 40, h: 50 + (index % 2) * 30 }]));

  const rects = (graph: MermaidGraph, sizes: Map<string, { w: number; h: number }>) => {
    const positions = layoutGraph(graph, sizes);
    return new Map(graph.nodes.map((node) => [node.id, { ...positions.get(node.id)!, ...sizes.get(node.id)! }]));
  };

  const noOverlap = (boxes: Map<string, { x: number; y: number; w: number; h: number }>): void => {
    const list = [...boxes];
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) assert.ok(!intersects(list[a]![1], list[b]![1]), `${list[a]![0]} et ${list[b]![0]} se chevauchent`);
    }
  };

  const dag = 'A --> B\n A --> C\n B --> D\n C --> D\n D --> E\n A --> E\n C --> F\n F --> G\n B --> G';

  it('fait descendre les liens en TB et monter en BT, sans chevauchement', () => {
    for (const direction of ['TB', 'BT'] as const) {
      const graph = parseMermaid(`flowchart ${direction}\n${dag}`);
      const boxes = rects(graph, sized(graph));
      noOverlap(boxes);
      for (const edge of graph.edges) {
        const from = boxes.get(edge.from)!;
        const to = boxes.get(edge.to)!;
        if (direction === 'TB') assert.ok(to.y >= from.y + from.h + 60, `${edge.from} → ${edge.to} descend`);
        else assert.ok(from.y >= to.y + to.h + 60, `${edge.from} → ${edge.to} monte`);
      }
      assert.equal(Math.min(...[...boxes.values()].map((box) => box.x)), 0);
      assert.equal(Math.min(...[...boxes.values()].map((box) => box.y)), 0);
    }
  });

  it('fait aller les liens vers la droite en LR et vers la gauche en RL', () => {
    for (const direction of ['LR', 'RL'] as const) {
      const graph = parseMermaid(`flowchart ${direction}\n${dag}`);
      const boxes = rects(graph, sized(graph));
      noOverlap(boxes);
      for (const edge of graph.edges) {
        const from = boxes.get(edge.from)!;
        const to = boxes.get(edge.to)!;
        if (direction === 'LR') assert.ok(to.x >= from.x + from.w + 60, `${edge.from} → ${edge.to} va à droite`);
        else assert.ok(from.x >= to.x + to.w + 60, `${edge.from} → ${edge.to} va à gauche`);
      }
    }
  });

  it('casse les cycles et place les composantes côte à côte', () => {
    const cyclic = parseMermaid('flowchart TD\n A --> B --> C --> A\n C --> D --> B\n D --> D');
    const boxes = rects(cyclic, sized(cyclic));
    noOverlap(boxes);
    assert.equal(boxes.size, 4);
    const apart = parseMermaid('flowchart TD\n A --> B\n C --> D\n E');
    const placed = rects(apart, sized(apart));
    noOverlap(placed);
    const right = (ids: string[]): number => Math.max(...ids.map((id) => placed.get(id)!.x + placed.get(id)!.w));
    const left = (ids: string[]): number => Math.min(...ids.map((id) => placed.get(id)!.x));
    assert.ok(right(['A', 'B']) < left(['C', 'D']));
    assert.ok(right(['C', 'D']) < left(['E']));
  });

  it('ne chevauche jamais, même sur un grand graphe dense', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const lines = ['flowchart TD'];
    for (let index = 0; index < 120; index += 1) lines.push(`N${Math.floor(random() * 60)} --> N${Math.floor(random() * 60)}`);
    const graph = parseMermaid(lines.join('\n'));
    noOverlap(rects(graph, sized(graph)));
  });
});

describe('Import Mermaid sur un tableau', () => {
  const text = 'flowchart TD\n  subgraph g [Groupe]\n    A[Un] --> B{Deux}\n  end\n  B -.->|ensuite| C((Trois))\n  g --> C\n  D[Seul]';

  it('crée des formes, des liens accrochés et des sections autour des groupes', () => {
    const elements = mermaidToElements(text, { x: 1000, y: -200 }, { idFactory: counter(), zStart: 50 });
    assert.deepEqual(
      elements.map((element) => [element.id, element.type, element.z]),
      [
        ['e1', 'frame', 50],
        ['e2', 'shape', 51],
        ['e3', 'shape', 52],
        ['e4', 'shape', 53],
        ['e5', 'shape', 54],
        ['e6', 'connector', 55],
        ['e7', 'connector', 56],
        ['e8', 'connector', 57],
      ],
    );
    const byId = new Map(elements.map((element) => [element.id, element]));
    const frame = elements[0] as FrameElement;
    const shapes = elements.filter((element): element is ShapeElement => element.type === 'shape');
    assert.equal(frame.title, 'Groupe');
    assert.deepEqual(
      shapes.map((element) => [element.text, element.shape, element.color, element.fill, element.size]),
      [
        ['Un', 'rect', 'default', 'solid', 'm'],
        ['Deux', 'diamond', 'default', 'solid', 'm'],
        ['Trois', 'ellipse', 'default', 'solid', 'm'],
        ['Seul', 'rect', 'default', 'solid', 'm'],
      ],
    );
    const [one, two, three, alone] = shapes as [ShapeElement, ShapeElement, ShapeElement, ShapeElement];
    assert.ok(contains(frame, one) && contains(frame, two), 'la section entoure son groupe');
    assert.ok(!intersects(frame, three) && !intersects(frame, alone), 'et rien d’autre');
    assert.ok(one.y - frame.y >= 24 + 32 && frame.x + frame.w - Math.max(one.x + one.w, two.x + two.w) >= 24);
    assert.ok(two.w > one.w && two.h > one.h, 'un losange est plus grand pour son texte');
    for (let a = 0; a < shapes.length; a += 1) for (let b = a + 1; b < shapes.length; b += 1) assert.ok(!intersects(shapes[a]!, shapes[b]!));
    const placed = elements.filter((element): element is PlacedElement => element.type !== 'connector');
    assert.equal(Math.min(...placed.map((element) => element.x)), 1000);
    assert.equal(Math.min(...placed.map((element) => element.y)), -200);

    const connectors = elements.filter((element): element is ConnectorElement => element.type === 'connector');
    assert.deepEqual(
      connectors.map((connector) => [connector.from.id, connector.to.id, connector.label, connector.dashed, connector.arrowEnd]),
      [
        ['e2', 'e3', '', false, true],
        ['e3', 'e4', 'ensuite', true, true],
        ['e1', 'e4', '', false, true],
      ],
    );
    for (const connector of connectors) {
      assert.equal(connector.route, 'elbow');
      assert.equal(connector.color, 'default');
      for (const end of [connector.from, connector.to]) {
        const target = byId.get(end.id!) as PlacedElement;
        assert.equal(end.side, null);
        assert.deepEqual([end.x, end.y], [target.x + target.w / 2, target.y + target.h / 2], 'extrémité au centre de l’élément accroché');
      }
    }
  });

  it('pose les sections imbriquées les unes dans les autres', () => {
    const elements = mermaidToElements('flowchart LR\n  subgraph out [Dehors]\n    A --> B\n    subgraph in [Dedans]\n      C --> D\n    end\n  end\n  B --> C\n  E --> A', { x: 0, y: 0 });
    const frames = elements.filter((element): element is FrameElement => element.type === 'frame');
    assert.deepEqual(
      frames.map((frame) => frame.title),
      ['Dehors', 'Dedans'],
    );
    assert.ok(contains(frames[0]!, frames[1]!));
    assert.ok(frames[0]!.z < frames[1]!.z);
    const shapes = new Map(elements.filter((element): element is ShapeElement => element.type === 'shape').map((element) => [element.text, element]));
    for (const id of ['C', 'D']) assert.ok(contains(frames[1]!, shapes.get(id)!));
    for (const id of ['A', 'B']) assert.ok(contains(frames[0]!, shapes.get(id)!) && !intersects(frames[1]!, shapes.get(id)!));
    assert.ok(!intersects(frames[0]!, shapes.get('E')!));
  });

  it('refuse un diagramme trop grand pour un tableau', () => {
    const lines = ['flowchart TD'];
    for (let index = 0; index <= 5000; index += 1) lines.push(`N${index}`);
    assert.throws(() => mermaidToElements(lines.join('\n'), { x: 0, y: 0 }), MermaidError);
  });
});
