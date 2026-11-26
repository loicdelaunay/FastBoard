import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachmentIdOf, attachmentMarkdown, attachmentMarkdownUrl, pastedFileName } from '../../shared/attachmentMarkdown.ts';

describe('pièces jointes dans la description d’un ticket', () => {
  it('écrit une image affichée sur place, un autre fichier en lien, sans casser le Markdown', () => {
    assert.equal(attachmentMarkdown({ id: 12, name: 'schéma réseau.png' }, true), '![schéma réseau](/api/attachments/12/download?inline=1)');
    assert.equal(attachmentMarkdown({ id: 13, name: 'devis [v2].pdf' }, false), '[devis v2.pdf](/api/attachments/13/download)');
    assert.equal(attachmentMarkdown({ id: 14, name: '.png' }, true), '![image](/api/attachments/14/download?inline=1)');
    assert.equal(attachmentMarkdownUrl(3, false), '/api/attachments/3/download');
  });

  it('retrouve la pièce jointe d’une adresse du texte', () => {
    assert.equal(attachmentIdOf('/api/attachments/12/download?inline=1'), 12);
    assert.equal(attachmentIdOf('/api/attachments/12/download'), 12);
    assert.equal(attachmentIdOf('https://exemple.fr/api/attachments/12/download'), null);
    assert.equal(attachmentIdOf('/api/attachments/x/download'), null);
  });

  it('date les captures collées, garde les autres noms', () => {
    const now = new Date(2026, 10, 26, 14, 30, 15);
    assert.equal(pastedFileName('image.png', now), 'capture-20261126-143015.png');
    assert.equal(pastedFileName('image.jpeg', now, 1, 3), 'capture-20261126-143015-2.jpeg');
    assert.equal(pastedFileName('plan.png', now), 'plan.png');
  });
});
