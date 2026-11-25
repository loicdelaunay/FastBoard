import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codeFences, fenceLanguageChange, matchingFences } from '../../shared/codeFences.ts';

/** Blocs de code d'une note : retrouvés depuis le rendu (langage et code), puis leur langage changé dans le texte. */
describe('blocs de code délimités', () => {
  const apply = (text: string, change: { from: number; to: number; insert: string }) => text.slice(0, change.from) + change.insert + text.slice(change.to);

  it('trouve chaque bloc avec son langage et son code, y compris dans une liste ou une citation', () => {
    const text = [
      '# Titre',
      '```python',
      'print(1)',
      '```',
      '- point',
      '   ~~~bash',
      '   ls -la',
      '     echo',
      '   ~~~',
      '> ```',
      '> brut',
      '> ```',
      '````md',
      '```js',
      'dedans',
      '```',
      '````',
    ].join('\n');
    const fences = codeFences(text);
    assert.deepEqual(
      fences.map((fence) => [fence.lang, fence.content]),
      [
        ['python', 'print(1)'],
        ['bash', 'ls -la\n  echo'],
        ['', 'brut'],
        ['md', '```js\ndedans\n```'],
      ],
    );
  });

  it('change le langage en gardant les attributs, ou le retire', () => {
    const text = 'avant\n```python title="a.py"\nx = 1\n```\n```\nsans\n```\n';
    const [python, plain] = matchingFences(text, 'python', 'x = 1').concat(matchingFences(text, '', 'sans'));
    assert.equal(apply(text, fenceLanguageChange(text, python!, 'ruby')), 'avant\n```ruby title="a.py"\nx = 1\n```\n```\nsans\n```\n');
    assert.equal(apply(text, fenceLanguageChange(text, python!, '')), 'avant\n```text title="a.py"\nx = 1\n```\n```\nsans\n```\n', 'sans langage, un attribut ne doit pas passer pour lui');
    assert.equal(apply(text, fenceLanguageChange(text, plain!, '')), text);
    assert.equal(apply(text, fenceLanguageChange(text, plain!, 'sql')), 'avant\n```python title="a.py"\nx = 1\n```\n```sql\nsans\n```\n');
  });

  it('distingue des blocs identiques par leur rang, et ignore un bloc qui ne correspond plus', () => {
    const text = '```js\na()\n```\ntexte\n```js\na()\n```\n';
    const same = matchingFences(text, 'js', 'a()');
    assert.equal(same.length, 2);
    assert.equal(apply(text, fenceLanguageChange(text, same[1]!, 'ts')), '```js\na()\n```\ntexte\n```ts\na()\n```\n');
    assert.equal(matchingFences(text, 'js', 'b()').length, 0);
  });
});
