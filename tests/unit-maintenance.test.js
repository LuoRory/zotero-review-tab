const test = require('node:test');
const assert = require('node:assert/strict');
const maintenance = require('../unit-maintenance.js');

function stateFixture() {
  return {
    units: {
      'article:A': { id: 'article:A', parentKey: 'A' },
      'book-session:A:2026-10-11': { id: 'book-session:A:2026-10-11', parentKey: 'A' },
      'article:B': { id: 'article:B', parentKey: 'B' }
    },
    dailyQueue: { dayKey: '2026-10-18', items: [{ unitId: 'article:A' }, { unitId: 'article:B' }, { unitId: 'book-session:A:2026-10-11' }] }
  };
}

test('deleting every note and annotation removes the unit and its queue refs', () => {
  const state = stateFixture();
  const removed = maintenance.pruneRebuiltParent(state, 'A', ['article:A']);
  assert.deepEqual(removed, ['book-session:A:2026-10-11']);
  assert.equal(Object.hasOwn(state.units, 'book-session:A:2026-10-11'), false);
  assert.equal(state.dailyQueue.items.length, 2);
  assert.ok(state.dailyQueue.items.every(item => item.unitId !== 'book-session:A:2026-10-11'));
});

test('rebuilt parent keeps units that still have source content', () => {
  const state = stateFixture();
  const removed = maintenance.pruneRebuiltParent(state, 'A', ['article:A', 'book-session:A:2026-10-11']);
  assert.deepEqual(removed, []);
  assert.equal(Object.keys(state.units).length, 3);
});

test('deleting the parent removes all of its units', () => {
  const state = stateFixture();
  assert.equal(maintenance.forgetParent(state, 'A'), true);
  assert.equal(Object.hasOwn(state.units, 'article:A'), false);
  assert.equal(Object.hasOwn(state.units, 'book-session:A:2026-10-11'), false);
  assert.equal(Object.hasOwn(state.units, 'article:B'), true);
  assert.deepEqual(state.dailyQueue.items.map(item => item.unitId), ['article:B']);
});

test('forgetting an unknown parent is a no-op', () => {
  const state = stateFixture();
  assert.equal(maintenance.forgetParent(state, 'MISSING'), false);
  assert.equal(Object.keys(state.units).length, 3);
});

test('queue refs to missing units are pruned', () => {
  const state = stateFixture();
  delete state.units['article:B'];
  assert.equal(maintenance.pruneQueue(state), 1);
  assert.deepEqual(state.dailyQueue.items.map(item => item.unitId), ['article:A', 'book-session:A:2026-10-11']);
});

test('purge handles missing queue gracefully', () => {
  const state = { units: {} };
  assert.equal(maintenance.purgeUnitFromQueue(state, 'x'), false);
  assert.equal(maintenance.pruneQueue(state), 0);
});

test('source unavailability preserves review history and queue references', () => {
  const state = stateFixture();
  state.units['article:A'].reviewLogs = [{ rating: 3 }];
  state.units['article:A'].fsrsCard = { due: '2026-10-20' };
  assert.equal(maintenance.markUnavailable(state, 'A', new Set()), true);
  assert.equal(state.units['article:A'].sourceUnavailable, true);
  assert.deepEqual(state.units['article:A'].reviewLogs, [{ rating: 3 }]);
  assert.equal(state.dailyQueue.items.length, 3);
  assert.equal(maintenance.markUnavailable(state, 'A', new Set(['article:A'])), true);
  assert.equal(state.units['article:A'].sourceUnavailable, false);
});
