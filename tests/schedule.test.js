const test = require('node:test');
const assert = require('node:assert/strict');

const { nextReviewAt, readingDayKey, recommendationScore } = require('../schedule.js');

test('reading day begins at configured 04:00 boundary', () => {
  assert.equal(readingDayKey(new Date('2026-10-18T03:59:00'), 4), '2026-10-17');
  assert.equal(readingDayKey(new Date('2026-10-18T04:00:00'), 4), '2026-10-18');
});

test('schedule advances through fixed revisit intervals', () => {
  const at = new Date('2026-10-18T12:00:00Z');
  assert.equal(nextReviewAt(at, 0, 3).toISOString(), '2026-10-21T12:00:00.000Z');
  assert.equal(nextReviewAt(at, 1, 3).toISOString(), '2026-10-28T12:00:00.000Z');
  assert.equal(nextReviewAt(at, 4, 3).toISOString(), '2027-04-16T12:00:00.000Z');
});

test('overdue, not-yet-reviewed material ranks above less overdue items', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const early = { dueAt: '2026-10-10T12:00:00Z', reviewCount: 0, activityCount: 3 };
  const recent = { dueAt: '2026-10-17T12:00:00Z', reviewCount: 2, activityCount: 3 };
  assert.ok(recommendationScore(early, now) > recommendationScore(recent, now));
});
