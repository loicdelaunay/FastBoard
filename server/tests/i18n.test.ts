import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { en } from '../../src/i18n/en.ts';
import { GLOBAL_PERMISSIONS, PROJECT_PERMISSIONS, SYSTEM_ROLES } from '../../shared/permissions.ts';
import { THEMES } from '../../shared/themes.ts';
import { DEFAULT_CATEGORIES, DEFAULT_PRIORITIES, LINK_REASONS, STATUS_META } from '../../shared/constants.ts';
import { CHANGELOG } from '../../shared/changelog.ts';
import { LOG_LEVEL_META, MONITORING_RANGES } from '../../shared/monitoring.ts';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const CALL = /(?<![\w.])\$?t\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
const ESCAPE = /\\(.)/g;

/** Textes passés à t() / $t() dans le code de l'interface. */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'i18n') walk(full);
        continue;
      }
      if (!/\.(vue|ts)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(CALL)) {
        used.set(match[2]!.replace(ESCAPE, '$1'), path.relative(srcDir, full));
      }
    }
  };
  walk(srcDir);
  return used;
}

describe('traductions', () => {
  it("l'anglais couvre tous les textes de l'interface", () => {
    const missing = [...usedKeys()].filter(([key]) => !(key in en));
    assert.deepEqual(missing.map(([key, file]) => `${file}: ${key}`), []);
  });

  it("l'anglais couvre les libellés partagés (statuts, permissions, rôles, thèmes, supervision, priorités, journal des versions)", () => {
    const shared = [
      ...Object.values(STATUS_META).map((meta) => meta.label),
      ...DEFAULT_CATEGORIES.map((category) => category.name),
      ...DEFAULT_PRIORITIES.map((priority) => priority.name),
      ...LINK_REASONS,
      ...CHANGELOG.flatMap((release) => release.changes.flatMap((change) => [change.category, change.text])),
      ...[...GLOBAL_PERMISSIONS, ...PROJECT_PERMISSIONS].flatMap((permission) => [permission.label, permission.description, permission.group]),
      ...SYSTEM_ROLES.flatMap((role) => [role.name, role.description]),
      ...THEMES.map((theme) => theme.label),
      ...Object.values(LOG_LEVEL_META).map((meta) => meta.label),
      ...Object.values(MONITORING_RANGES).map((range) => range.label),
    ];
    assert.deepEqual(shared.filter((text) => !(text in en)), []);
  });

  it('les variables et les formes plurielles sont cohérentes entre le français et l’anglais', () => {
    const variables = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    const problems: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const wanted = new Set(variables(key));
      const found = new Set(variables(value));
      for (const name of wanted) if (!found.has(name)) problems.push(`${key} → variable {${name}} absente`);
      for (const name of found) if (!wanted.has(name)) problems.push(`${key} → variable {${name}} inconnue`);
      if (key.split('|').length === 2 && value.split('|').length !== 2) problems.push(`${key} → forme plurielle manquante`);
    }
    assert.deepEqual(problems, []);
  });
});
