import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { drawioImageData, drawioImageName, drawioPages, drawioText, drawioToElements, looksLikeDrawio, nearestColor } from '../../shared/boardDrawio.ts';
import type { ConnectorElement, FrameElement, ImageElement, ShapeElement, TextElement } from '../../shared/boards.ts';

const MODEL = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Début&lt;br&gt;du &amp;amp; flux" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="Valide ?" style="rhombus;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1"><mxGeometry x="240" y="30" width="100" height="80" as="geometry"/></mxCell>
<mxCell id="t" value="Titre" style="text;html=1;fontSize=20;align=center;" vertex="1" parent="1"><mxGeometry x="40" y="200" width="160" height="30" as="geometry"/></mxCell>
<mxCell id="sw" value="Équipe" style="swimlane;fillColor=#e1d5e7;" vertex="1" parent="1"><mxGeometry x="600" y="20" width="200" height="200" as="geometry"/></mxCell>
<object label="Dedans" id="in"><mxCell style="ellipse;fillColor=#f8cecc;" vertex="1" parent="sw"><mxGeometry x="40" y="60" width="100" height="60" as="geometry"/></mxCell></object>
<mxCell id="img" value="Logo" style="shape=image;verticalLabelPosition=bottom;aspect=fixed;imageAspect=0;image=data:image/png,iVBORw0KGgo=;" vertex="1" parent="1"><mxGeometry x="0" y="300" width="64" height="48" as="geometry"/></mxCell>
<mxCell id="web" style="shape=image;image=https://exemple.fr/a.png;" vertex="1" parent="1"><mxGeometry x="100" y="300" width="10" height="10" as="geometry"/></mxCell>
<mxCell id="e1" value="oui" style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.25;entryX=0;entryY=0.5;jumpStyle=arc;flowAnimation=1;strokeWidth=3;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="200" y="55"/></Array></mxGeometry></mxCell>
<mxCell id="e2" style="curved=1;endArrow=none;startArrow=classic;dashed=1;strokeColor=#b85450;" edge="1" parent="1" source="b" target="in"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e3" edge="1" parent="1" target="b"><mxGeometry relative="1" as="geometry"><mxPoint x="300" y="300" as="sourcePoint"/></mxGeometry></mxCell>
<mxCell id="l3" value="libellé" style="edgeLabel;html=1;" vertex="1" parent="e3"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e4" edge="1" parent="1" source="a" target="img"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`;

describe('import draw.io', () => {
  it('reconnaît un diagramme et lit les pages, compressées ou non', async () => {
    assert.ok(looksLikeDrawio(`<?xml version="1.0"?>\n<mxfile><diagram name="P">x</diagram></mxfile>`));
    assert.ok(looksLikeDrawio(encodeURIComponent(MODEL)));
    assert.ok(!looksLikeDrawio('flowchart TD\n A --> B'));
    assert.equal((await drawioPages(MODEL)).length, 1);
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(MODEL))).toString('base64');
    const pages = await drawioPages(`<mxfile><diagram name="Un">${compressed}</diagram><diagram name="Deux">${MODEL}</diagram></mxfile>`);
    assert.deepEqual(
      pages.map((page) => page.name),
      ['Un', 'Deux'],
    );
    assert.equal(drawioToElements(pages[0]!.model).elements.length, drawioToElements(pages[1]!.model).elements.length);
  });

  it('convertit formes, textes, conteneurs et liens', () => {
    const { elements, images, skipped } = drawioToElements(MODEL);
    assert.equal(skipped, 0);
    // Les images deviennent des éléments `image` à remplir : intégrée au fichier (data:) ou à une adresse web.
    const pictures = elements.filter((element): element is ImageElement => element.type === 'image');
    assert.deepEqual(
      pictures.map((picture) => [picture.name, picture.w, picture.h, picture.asset]),
      [
        ['Logo', 64, 48, ''],
        ['image', 10, 10, ''],
      ],
    );
    assert.deepEqual(
      images.map((image) => [image.elementId, image.source]),
      [
        [pictures[0]!.id, 'data:image/png,iVBORw0KGgo='],
        [pictures[1]!.id, 'https://exemple.fr/a.png'],
      ],
    );
    const shapes = elements.filter((element): element is ShapeElement => element.type === 'shape');
    assert.deepEqual(
      shapes.map((shape) => [shape.shape, shape.text, shape.color]),
      [
        ['rounded', 'Début\ndu & flux', 'blue'],
        ['diamond', 'Valide ?', 'orange'],
        ['ellipse', 'Dedans', 'red'],
      ],
    );
    const inside = shapes[2]!;
    assert.deepEqual([inside.x, inside.y], [640, 80], 'position relative au conteneur');
    const frame = elements.find((element): element is FrameElement => element.type === 'frame')!;
    assert.equal(frame.title, 'Équipe');
    const text = elements.find((element): element is TextElement => element.type === 'text')!;
    assert.deepEqual([text.size, text.align], ['l', 'center']);

    const [first, second, third] = elements.filter((element): element is ConnectorElement => element.type === 'connector');
    assert.equal(first!.from.id, shapes[0]!.id);
    assert.deepEqual([first!.from.side, first!.from.t, first!.to.side, first!.to.t], ['right', 0.25, 'left', undefined]);
    assert.deepEqual([first!.route, first!.label, first!.weight, first!.jump, first!.animation], ['elbow', 'oui', 'l', 'arc', 'flow']);
    assert.deepEqual(first!.waypoints, [{ x: 200, y: 55 }]);
    assert.deepEqual([second!.route, second!.arrowStart, second!.arrowEnd, second!.dashed, second!.color], ['curve', true, false, true, 'red']);
    assert.deepEqual([third!.from.id, third!.from.x, third!.from.y, third!.label], [null, 300, 300, 'libellé']);
    const fourth = elements.filter((element): element is ConnectorElement => element.type === 'connector')[3]!;
    assert.equal(fourth.to.id, pictures[0]!.id, 'un lien s’accroche à une image');
  });

  it('lit les images intégrées à un fichier draw.io', () => {
    // draw.io écrit le base64 sans « ;base64 » ; la forme habituelle est lue aussi.
    const png = drawioImageData('data:image/png,iVBORw0KGgo=')!;
    assert.deepEqual([png.mime, [...png.bytes.slice(0, 4)]], ['image/png', [0x89, 0x50, 0x4e, 0x47]]);
    assert.deepEqual([...drawioImageData('data:image/png;base64,iVBORw0KGgo=')!.bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);
    const svg = drawioImageData('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E')!;
    assert.equal(new TextDecoder().decode(svg.bytes), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal(drawioImageData('https://exemple.fr/a.png'), null);
    assert.equal(drawioImageName('Mon: logo', 'image/svg+xml'), 'Mon logo.svg');
    assert.equal(drawioImageName('', 'image/png'), 'image.png');
  });

  it('lit les libellés HTML et rapproche les couleurs', () => {
    assert.equal(drawioText('<div>Ligne&nbsp;1</div><div>Ligne <b>2</b></div>'), 'Ligne 1\nLigne 2');
    assert.equal(nearestColor('#82b366'), 'green');
    assert.equal(nearestColor('#666666'), 'gray');
    assert.equal(nearestColor('#000000'), 'default');
    assert.equal(nearestColor('none'), null);
  });
});
