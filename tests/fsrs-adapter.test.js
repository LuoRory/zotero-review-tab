const test = require('node:test');
const assert = require('node:assert/strict');
const FSRS = require('../vendor/ts-fsrs-5.4.2.umd.js');
const adapterModule = require('../fsrs-adapter.js');

test('FSRS adapter creates a serializable rated card', () => {
  const adapter = adapterModule.createAdapter(FSRS, { enable_fuzz: true }, 4);
  const now = new Date('2026-10-18T09:00:00');
  const result = adapter.createRatedCard(null, 'article:ABC', now, FSRS.Rating.Good);
  assert.equal(result.log.rating, FSRS.Rating.Good);
  assert.equal(typeof result.card.stability, 'number');
  assert.equal(typeof result.card.difficulty, 'number');
  assert.equal(typeof result.card.due, 'string');
  assert.equal(typeof result.card.effectiveDueAt, 'string');
});

test('FSRS day jitter is deterministic and bounded', () => {
  const first = adapterModule.dayOffset('article:ABC');
  assert.equal(first, adapterModule.dayOffset('article:ABC'));
  assert.ok(first >= -1 && first <= 1);
});

test('practice uses no FSRS adapter operation', () => {
  const card = FSRS.createEmptyCard(new Date('2026-10-18T09:00:00'));
  const serialized = adapterModule.applyDuePolicy(card, 'practice-only', 4);
  assert.equal(serialized.state, FSRS.State.New);
  assert.equal(serialized.reps, 0);
});

test('first explicit rating gives a new card a non-new learning state', () => {
  const adapter = adapterModule.createAdapter(FSRS, { enable_fuzz: true }, 4);
  const result = adapter.createRatedCard(null, 'article:first-review', new Date('2026-10-18T09:00:00'), FSRS.Rating.Good);
  assert.notEqual(result.card.state, FSRS.State.New);
  assert.equal(result.log.rating, FSRS.Rating.Good);
});
