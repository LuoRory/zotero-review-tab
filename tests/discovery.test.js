const test = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../discovery.js');

const paper = { key: 'PAPER', itemType: 'journalArticle' };
const book = { key: 'BOOK', itemType: 'book' };

test('non-book source activities create one whole-work unit', () => {
  const groups = discovery.groupActivities([
    { parent: paper, activity: { isNote: true, isAnnotation: false, dateAdded: '2026-10-10T08:00:00Z' } },
    { parent: paper, activity: { isNote: false, isAnnotation: true, dateAdded: '2026-10-11T08:00:00Z', annotationPageLabel: '7' } }
  ], 4);
  assert.equal(groups.size, 1);
  const group = [...groups.values()][0];
  assert.equal(group.descriptor.id, 'article:PAPER');
  assert.deepEqual(discovery.sourceSummary(group), { annotationCount: 1, noteCount: 1, activityCount: 2, firstActivityAt: '2026-10-10T08:00:00.000Z', lastActivityAt: '2026-10-11T08:00:00.000Z', pageRange: { first: 7, last: 7 } });
});

test('book activities split by configured local reading day', () => {
  const groups = discovery.groupActivities([
    { parent: book, activity: { isNote: false, isAnnotation: true, dateAdded: '2026-10-11T03:30:00', annotationPageLabel: '20' } },
    { parent: book, activity: { isNote: false, isAnnotation: true, dateAdded: '2026-10-11T07:30:00', annotationPageLabel: '21' } }
  ], 4);
  assert.equal(groups.size, 2);
  assert.ok(groups.has('book-session:BOOK:2026-10-10'));
  assert.ok(groups.has('book-session:BOOK:2026-10-11'));
});

test('summary rebuild preserves user scheduling fields without source arrays', () => {
  const descriptor = { id: 'article:PAPER', parentKey: 'PAPER', unitType: 'article', sessionDay: null };
  const existing = { fsrsCard: { due: '2026-11-01T04:00:00Z' }, reviewLogs: [{ rating: 3 }], practiceLogs: [], lane: 'scheduled', priority: 'core', paused: false, stopped: false, lastReviewedAt: '2026-10-10T00:00:00Z', dueAt: '2026-11-01T04:00:00Z', activityKeys: ['obsolete'] };
  const result = discovery.applySummary(existing, descriptor, { annotationCount: 3, noteCount: 1, activityCount: 4, firstActivityAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-12T00:00:00Z', pageRange: null }, 'new');
  assert.equal(result.lane, 'scheduled');
  assert.equal(result.priority, 'core');
  assert.equal(result.annotationCount, 3);
  assert.equal(Object.hasOwn(result, 'activityKeys'), false);
});

test('ink drawings count as annotations', () => {
  const summary = discovery.sourceSummary({ descriptor: { id: 'article:PAPER' }, activities: [
    { isNote: false, isAnnotation: true, dateAdded: '2026-10-10T08:00:00Z', annotationPageLabel: '3' },
    { isNote: false, isAnnotation: false, inkCount: 2, dateAdded: '2026-10-10T09:00:00Z', annotationPageLabel: '4' }
  ] });
  assert.equal(summary.annotationCount, 3);
  assert.equal(discovery.annotationTotal({ annotationCount: 2, inkCount: 1 }), 3);
  assert.equal(discovery.annotationTotal({}), 0);
});

test('only paper and book item types enter review units', () => {
  assert.equal(discovery.isReviewableType('journalArticle'), true);
  assert.equal(discovery.isReviewableType('conferencePaper'), true);
  assert.equal(discovery.isReviewableType('thesis'), true);
  assert.equal(discovery.isReviewableType('book'), true);
  assert.equal(discovery.isReviewableType('bookSection'), true);
  assert.equal(discovery.isReviewableType('computerProgram'), false);
  assert.equal(discovery.isReviewableType('dataset'), false);
  assert.equal(discovery.isReviewableType('webpage'), false);
  assert.equal(discovery.isReviewableType('attachment'), false);
});

test('software entries are skipped during grouping', () => {
  const software = { key: 'SOFTWARE', itemType: 'computerProgram' };
  const groups = discovery.groupActivities([
    { parent: software, activity: { isNote: true, isAnnotation: false, dateAdded: '2026-10-10T08:00:00Z' } },
    { parent: paper, activity: { isNote: true, isAnnotation: false, dateAdded: '2026-10-10T08:00:00Z' } }
  ], 4);
  assert.equal(groups.size, 1);
  assert.ok(groups.has('article:PAPER'));
});

test('blank page labels do not create a fictitious page zero range', () => {
  const summary = discovery.sourceSummary({ descriptor: { id: 'article:PAPER' }, activities: [
    { isNote: false, isAnnotation: true, dateAdded: '2026-10-10T08:00:00Z', annotationPageLabel: '' },
    { isNote: true, isAnnotation: false, dateAdded: '2026-10-10T09:00:00Z', annotationPageLabel: null }
  ] });
  assert.equal(summary.pageRange, null);
});
