const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../queue-policy.js');

function unit(id, lane, parentKey = id, extra = {}) {
  return Object.assign({ id, lane, parentKey, priority: 'normal', annotationCount: 1, noteCount: 0, lastActivityAt: '2026-10-15T00:00:00Z', paused: false, stopped: false }, extra);
}

test('daily queue uses stable local 04:00 day boundary', () => {
  assert.equal(queue.localDayKey(new Date('2026-10-18T03:59:00'), 4), '2026-10-17');
  assert.equal(queue.localDayKey(new Date('2026-10-18T04:00:00'), 4), '2026-10-18');
});

test('due cards strictly occupy a full daily queue', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const units = Array.from({ length: 24 }, (_, index) => unit(`d${index}`, 'scheduled', `p${index}`, { fsrsCard: { due: '2026-10-01T04:00:00Z', effectiveDueAt: '2026-10-01T04:00:00Z' } }));
  units.push(unit('new', 'new'));
  const result = queue.buildQueue(units, now, 4, { total: 20, newMax: 6, newMin: 1 });
  assert.equal(result.items.length, 20);
  assert.equal(result.stats.new, 0);
  assert.ok(result.items.every(item => item.source === 'due'));
});

test('queue preserves one new-card minimum while capacity remains', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const units = [unit('due', 'scheduled', 'due-parent', { fsrsCard: { due: '2026-10-01T04:00:00Z', effectiveDueAt: '2026-10-01T04:00:00Z' } }), unit('new', 'new', 'new-parent'), ...Array.from({ length: 100 }, (_, index) => unit(`b${index}`, 'backlog', `b${index}`))];
  const result = queue.buildQueue(units, now, 4, { total: 20, newMax: 6, newMin: 1 });
  assert.ok(result.items.some(item => item.unitId === 'new'));
  assert.ok(result.items.length <= 20);
});

test('queue does not admit multiple units from one parent', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const result = queue.buildQueue([unit('book-a', 'backlog', 'same-book'), unit('book-b', 'backlog', 'same-book'), unit('other', 'backlog', 'other-book')], now, 4, { total: 20, newMax: 6, newMin: 1 });
  const parents = result.items.map(item => ({ 'book-a': 'same-book', 'book-b': 'same-book', other: 'other-book' }[item.unitId]));
  assert.equal(new Set(parents).size, parents.length);
});

test('due cards remain ordered by earliest due date instead of candidate priority', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const units = [
    unit('later-high-priority', 'scheduled', 'later', { priority: 'core', fsrsCard: { due: '2026-10-17T04:00:00Z' } }),
    unit('earlier-low-priority', 'scheduled', 'earlier', { priority: 'low', fsrsCard: { due: '2026-10-01T04:00:00Z' } })
  ];
  const result = queue.buildQueue(units, now, 4, { total: 20, newMax: 6, newMin: 1 });
  assert.deepEqual(result.items.map(item => item.unitId), ['earlier-low-priority', 'later-high-priority']);
});

test('unavailable sources are not admitted to review queues', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const result = queue.buildQueue([unit('missing', 'new', 'missing', { sourceUnavailable: true }), unit('active', 'new')], now, 4);
  assert.deepEqual(result.items.map(item => item.unitId), ['active']);
});
