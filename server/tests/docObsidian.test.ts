import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandWikiLinks, findHeading, headingKey, imageSize, resolveDocLink } from '../../shared/docLinks.ts';
import { blockIds, embeds, footnotes, highlightColor, prepareDocText, properties, sectionOf } from '../../shared/docObsidian.ts';
import type { DocNodeDTO } from '../../shared/docs.ts';
import { docOutline } from '../../shared/docOutline.ts';

describe('Markdown d’Obsidian', () => {
  it('numérote les notes de bas de page dans l’ordre de leur appel, et les réunit en fin de note', () => {
    const text = footnotes('Deux[^b] puis un[^a] et encore[^b].\n\n[^a]: Note A.\n[^b]: Note B\n    sur deux lignes.');
    assert.match(text, /data-fn="b">1<\/a>/);
    assert.match(text, /data-fn="a">2<\/a>/);
    assert.equal(text.match(/data-fn="b"/g)?.length, 2, 'un même renvoi garde son numéro');
    const notes = text.slice(text.indexOf('<section class="md-footnotes">'));
    assert.ok(notes.indexOf('Note B sur deux lignes.') < notes.indexOf('Note A.'));
    assert.ok(!text.includes('[^a]:'), 'les définitions quittent le corps');
  });

  it('accepte une note en ligne, et ignore un renvoi sans définition ou dans le code', () => {
    assert.match(footnotes('Texte^[en passant].'), /data-fn-def="en-ligne-1"><\/span>en passant/);
    assert.equal(footnotes('Rien[^x] ici'), 'Rien[^x] ici');
    assert.ok(footnotes('`[^a]` et [^a]\n\n[^a]: A').startsWith('`[^a]` et <sup'));
  });

  it('présente les propriétés en tête de note', () => {
    const html = properties('---\ntags: [guide, "démarrage"]\nauteur: Léa\nliste:\n  - un\n  - deux\n---\n\n# Titre');
    assert.match(html, /<span class="md-property-key">tags<\/span><span class="md-property-value"><span>guide<\/span><span>démarrage<\/span>/);
    assert.match(html, /<span>un<\/span><span>deux<\/span>/);
    assert.ok(html.endsWith('# Titre'));
    assert.equal(properties('Texte\n---\nx: 1\n---'), 'Texte\n---\nx: 1\n---', 'seulement en tête');
    assert.ok(!properties('---\nx: <b>\n---\n').includes('<b>'), 'le texte est échappé');
  });

  it('intègre une note, mais laisse une image en image', () => {
    assert.equal(embeds('![[Installation#Étape 2]]'), '<span class="md-embed" data-embed="Installation#Étape 2"></span>');
    assert.equal(embeds('![[schéma.png]]'), '![[schéma.png]]');
    assert.equal(embeds('`![[Note]]`'), '`![[Note]]`');
  });

  it('retire les identifiants de bloc', () => {
    assert.equal(blockIds('Une phrase ^abc-1\n^bloc\nSuite'), 'Une phrase\n\nSuite');
  });

  it('ne touche à rien quand l’espace n’accepte pas la syntaxe d’Obsidian', () => {
    const text = '---\na: 1\n---\nTexte[^1] ![[Note]]\n\n[^1]: Note';
    assert.equal(prepareDocText(text, false), expandWikiLinks(text));
    assert.ok(prepareDocText(text, true).includes('md-properties'));
  });

  it('extrait la section d’un titre pour une note intégrée', () => {
    const text = '# Note\n\n## Un\n\nA\n\n### Sous\n\nB\n\n## Deux\n\nC';
    assert.equal(sectionOf(text, 'un'), '## Un\n\nA\n\n### Sous\n\nB\n');
    assert.equal(sectionOf(text, 'Absent'), text);
  });

  it('garde le titre visé par un lien wiki', () => {
    assert.equal(expandWikiLinks('[[#Plus bas]]'), '[Plus bas](#Plus%20bas)');
    assert.equal(headingKey('  Étape   2 '), 'étape 2');
  });

  it('retrouve une image par la fin de son chemin, et l’homonyme le plus proche de la note', () => {
    const file = (id: number, path: string, kind: 'markdown' | 'image' = 'image') => ({ id, path, kind }) as DocNodeDTO;
    const nodes = [file(1, 'Tests/images/schema.png'), file(2, 'Projet/Pictures/images/schema.png'), file(3, 'Projet/Pictures/Vue (1).PNG'), file(4, 'Projet/Ma note.md', 'markdown')];
    assert.equal(resolveDocLink(nodes, 'Projet/Ma note.md', 'Pictures/Vue (1).PNG')?.id, 3, 'à côté de la note');
    assert.equal(resolveDocLink(nodes, 'Projet/Ma note.md', 'Pictures/images/schema.png')?.id, 2);
    assert.equal(resolveDocLink(nodes, 'Autre/Note.md', 'images/schema.png')?.id, 1, 'fin du chemin, le plus court à égalité');
    assert.equal(resolveDocLink(nodes, 'Projet/Ma note.md', 'schema.png')?.id, 2, 'par le nom : le plus proche de la note');
    assert.equal(resolveDocLink(nodes, 'Tests/Note.md', 'schema.png')?.id, 1);
    assert.equal(resolveDocLink(nodes, 'Projet/Ma note.md', 'Pictures/absente.png'), undefined);
  });

  it('lit la taille d’une image à la manière d’Obsidian', () => {
    assert.deepEqual(imageSize('300'), { alt: '', width: 300, height: null });
    assert.deepEqual(imageSize('Schéma|300x200'), { alt: 'Schéma', width: 300, height: 200 });
    assert.deepEqual(imageSize('Schéma de 2024'), { alt: 'Schéma de 2024', width: null, height: null });
    assert.equal(expandWikiLinks('![[Pictures/Vue (1).png|120]]'), '![120](Pictures/Vue%20(1).png)');
  });

  it('retrouve le titre visé par une ancre écrite autrement', () => {
    const titles = ['Sommaire', '1.1.1 UAV OAT', '1.2 Capteurs', 'Étape 2'];
    assert.equal(findHeading(titles, '1.1.1^UAV^OAT'), 1);
    assert.equal(findHeading(titles, '1.2-capteurs'), 2);
    assert.equal(findHeading(titles, 'etape-2'), 3);
    assert.equal(findHeading(titles, '  étape   2 '), 3, 'à l’identique d’abord');
    assert.equal(findHeading(titles, 'Absent'), -1);
    assert.equal(findHeading(titles, '^^'), -1);
  });

  it('colore un surlignage d’après sa bille emoji', () => {
    assert.equal(highlightColor('🟢 Validé'), 'green');
    assert.equal(highlightColor(' 🟥 Bloqué'), 'red');
    assert.equal(highlightColor('Texte 🟢'), null);
    assert.equal(highlightColor(''), null);
  });

  it('ne prend pas les propriétés en tête de note pour des titres', () => {
    assert.deepEqual(docOutline('---\ntitre: x\nstatut: brouillon\n---\n\n# Vrai titre').map((heading) => heading.title), ['Vrai titre']);
  });
});
