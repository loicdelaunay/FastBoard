import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, diffDays, formatDateFr, isISODate, isoWeekNumber, isoWeekday, toDayNumber } from '../../shared/dates.ts';
import { hasPermission, isSubsetOfPermissions, SYSTEM_ROLES, ALL_PROJECT_PERMISSION_KEYS } from '../../shared/permissions.ts';
import { suggestProjectKey } from '../../shared/projectKey.ts';
import { assigneeProgress, partsSummary, ticketProgress } from '../../shared/progress.ts';
import { resolveRange } from '../../shared/schedule.ts';

describe('progression des tickets', () => {
  it("vaut toujours 100 % pour un ticket terminé", () => {
    assert.equal(ticketProgress({ status: 'done', progress: 10, assignees: [{ done: false, progress: 0 }] }), 100);
  });

  it("fait la moyenne des parts des assignés (une part terminée compte pour 100 %)", () => {
    const assignees = [
      { done: true, progress: 0 },
      { done: false, progress: 40 },
      { done: false, progress: 10 },
    ];
    assert.equal(ticketProgress({ status: 'in_progress', progress: 0, assignees }), 50);
    assert.deepEqual(partsSummary({ assignees }), { done: 1, total: 3 });
    assert.equal(assigneeProgress({ done: true, progress: 12 }), 100);
  });

  it("utilise l'avancement manuel sans assigné et borne les valeurs", () => {
    assert.equal(ticketProgress({ status: 'todo', progress: 35, assignees: [] }), 35);
    assert.equal(ticketProgress({ status: 'todo', progress: 250, assignees: [] }), 100);
    assert.equal(ticketProgress({ status: 'todo', progress: -4, assignees: [] }), 0);
  });
});

describe('dates calendaires', () => {
  it('valide et calcule sans décalage de fuseau', () => {
    assert.ok(isISODate('2026-02-28'));
    assert.ok(!isISODate('2026-02-30'));
    assert.ok(!isISODate('26-02-28'));
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(addDays('2026-03-28', 3), '2026-03-31');
    assert.equal(diffDays('2026-10-24', '2026-10-27'), 3);
    assert.equal(formatDateFr('2026-10-15'), '15/10/2026');
  });

  it('numérote les semaines ISO', () => {
    assert.equal(isoWeekNumber(toDayNumber('2026-01-01')), 1);
    assert.equal(isoWeekNumber(toDayNumber('2026-10-15')), 42);
    assert.equal(isoWeekNumber(toDayNumber('2020-12-31')), 53);
    assert.equal(isoWeekday(toDayNumber('2026-10-15')), 4);
  });
});

describe('permissions', () => {
  it('le joker accorde tout et empêche toute escalade', () => {
    assert.ok(hasPermission(['*'], 'users.delete'));
    assert.ok(!hasPermission(['users.view'], 'users.delete'));
    assert.ok(isSubsetOfPermissions(['users.view'], ['users.view', 'users.edit']));
    assert.ok(!isSubsetOfPermissions(['users.delete'], ['users.view']));
    assert.ok(!isSubsetOfPermissions(['*'], ['users.view']));
    assert.ok(isSubsetOfPermissions(['*'], ['*']));
  });

  it('le propriétaire possède toutes les permissions de projet, le lecteur aucune', () => {
    const owner = SYSTEM_ROLES.find((role) => role.key === 'owner')!;
    const viewer = SYSTEM_ROLES.find((role) => role.key === 'viewer')!;
    assert.deepEqual(owner.permissions, ALL_PROJECT_PERMISSION_KEYS);
    assert.deepEqual(viewer.permissions, []);
  });
});

describe('clé de projet et planning', () => {
  it('propose une clé lisible', () => {
    assert.equal(suggestProjectKey('Refonte du site vitrine'), 'RDSV');
    assert.equal(suggestProjectKey('Application'), 'APPL');
    assert.equal(suggestProjectKey('été 2026'), 'E2');
  });

  it("complète les dates d'un ticket avec celles de sa livraison", () => {
    const delivery = { startDate: '2026-11-01', endDate: '2026-11-30' };
    assert.deepEqual(resolveRange({ startDate: '2026-11-03', endDate: '2026-11-10' }, delivery), { start: '2026-11-03', end: '2026-11-10', inherited: false });
    assert.deepEqual(resolveRange({ startDate: '2026-11-03', endDate: null }, delivery), { start: '2026-11-03', end: '2026-11-30', inherited: false });
    assert.deepEqual(resolveRange({ startDate: null, endDate: '2026-11-10' }, delivery), { start: '2026-11-01', end: '2026-11-10', inherited: false });
    assert.deepEqual(resolveRange({ startDate: null, endDate: null }, delivery), { start: '2026-11-01', end: '2026-11-30', inherited: true });
    assert.equal(resolveRange({ startDate: null, endDate: null }, undefined), null);
  });
});
