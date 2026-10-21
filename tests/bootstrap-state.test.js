const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function pluginForNote(noteHTML, preferences = {}, items = {}) {
  const errors = [];
  const context = {
    Zotero: {
      Prefs: { get: key => preferences[key] },
      Libraries: { userLibraryID: 1 },
      Items: { get: id => items[id] || null, getAsync: async id => Array.isArray(id) ? id.map(key => items[key]).filter(Boolean) : items[id] || null },
      DB: { columnQueryAsync: async () => [] },
      getMainWindows: () => [],
      debug() {},
      logError(error) { errors.push(error); }
    },
    setTimeout, clearTimeout, Map, Set, WeakMap, Promise, Date, JSON, Object, String, Number, Error, RegExp
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8'), context, { filename: 'bootstrap.js' });
  const plugin = context.ReviewTabPlugin;
  plugin.FSRS = { generatorParameters: () => ({ enable_fuzz: true }) };
  plugin.fsrsAPI = { SCHEDULER_VERSION: 1 };
  plugin.getStateNote = async () => noteHTML === null ? null : { getNote: () => noteHTML };
  return { plugin, errors };
}

test('state with invalid JSON fails closed and never enters the cache', async () => {
  const { plugin, errors } = pluginForNote('<pre data-review-tab-state="true">{broken</pre>');
  await assert.rejects(plugin.loadState(1), /已停止写入/);
  assert.equal(plugin.stateCache.has(1), false);
  assert.equal(errors.length, 1);
});

test('state-note lookup preserves a title fallback after Zotero normalizes HTML', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bootstrap.js'), 'utf8');
  assert.match(source, /N\.note LIKE \? OR N\.title=\?/);
});

test('state survives Zotero note normalization without a custom pre attribute', async () => {
  const { plugin } = pluginForNote('<div><pre>{"format":"review-tab-sync","version":3,"libraryID":1,"units":{}}</pre></div>');
  const state = await plugin.loadState(1);
  assert.deepEqual(state.units, {});
});

test('state from another library fails closed', async () => {
  const { plugin } = pluginForNote('<pre data-review-tab-state="true">{"format":"review-tab-sync","version":3,"libraryID":2,"units":{}}</pre>');
  await assert.rejects(plugin.loadState(1), /已停止写入/);
  assert.equal(plugin.stateCache.has(1), false);
});

test('current state loads and an explicit midnight boundary is preserved', async () => {
  const { plugin } = pluginForNote('<pre data-review-tab-state="true">{"format":"review-tab-sync","version":3,"libraryID":1,"units":{}}</pre>', { 'extensions.review-tab.readingDayStartHour': 0 });
  const state = await plugin.loadState(1);
  assert.deepEqual(state.units, {});
  assert.equal(plugin.getBoundary(), 0);
});


test('metadata-only parent changes invalidate the view without scheduling a rebuild', async () => {
  const parent = { id: 10, key: 'PARENT', libraryID: 1, isRegularItem: () => true };
  const { plugin } = pluginForNote(null, {}, { 10: parent });
  let scheduled = 0;
  plugin.scheduleIntake = () => { scheduled += 1; };
  await plugin.notify('modify', 'item', [10], { 10: { changed: { title: 'Old title' } } });
  assert.equal(plugin.revision, 1);
  assert.equal(plugin.pendingParentKeys.size, 0);
  assert.equal(scheduled, 0);
});

test('item type and unknown parent changes retain conservative rebuild scheduling', async () => {
  const parent = { id: 10, key: 'PARENT', libraryID: 1, isRegularItem: () => true };
  const { plugin } = pluginForNote(null, {}, { 10: parent });
  let scheduled = 0;
  plugin.hasActiveReviewView = () => true;
  plugin.scheduleIntake = () => { scheduled += 1; };
  await plugin.notify('modify', 'item', [10], { 10: { changed: { itemType: 'book' } } });
  assert.deepEqual([...plugin.pendingParentKeys], ['PARENT']);
  assert.equal(scheduled, 1);
  plugin.pendingParentKeys.clear();
  await plugin.notify('modify', 'item', [10], {});
  assert.deepEqual([...plugin.pendingParentKeys], ['PARENT']);
  assert.equal(scheduled, 2);
});

test('legacy changes notifier metadata also avoids unnecessary rebuilds', async () => {
  const parent = { id: 10, key: 'PARENT', libraryID: 1, isRegularItem: () => true };
  const { plugin } = pluginForNote(null, {}, { 10: parent });
  plugin.hasActiveReviewView = () => true;
  plugin.scheduleIntake = () => { throw new Error('metadata-only change must not schedule intake'); };
  await plugin.notify('modify', 'item', [10], { 10: { changes: { firstCreator: 'Old creator' } } });
  assert.equal(plugin.revision, 1);
  assert.equal(plugin.pendingParentKeys.size, 0);
});

test('child changes are queued even when change details are present', async () => {
  const parent = { id: 10, key: 'PARENT', libraryID: 1, isRegularItem: () => true };
  const child = { id: 11, key: 'NOTE', libraryID: 1, parentItem: parent, isNote: () => true };
  const { plugin } = pluginForNote(null, {}, { 10: parent, 11: child });
  plugin.hasActiveReviewView = () => true;
  plugin.scheduleIntake = () => {};
  await plugin.notify('modify', 'item', [11], { 11: { changed: { title: 'Old' } } });
  assert.deepEqual([...plugin.pendingNotifierIDs], [11]);
  assert.equal(plugin.childParents.get(11), 'PARENT');
});

test('failed intake retains pending parent work and reports failure', async () => {
  const { plugin } = pluginForNote(null);
  const state = { initialContentCreatedAt: '2026-01-01', units: {}, dailyQueue: null };
  plugin.loadState = async () => state;
  plugin.findParent = async () => { throw new Error('lookup failed'); };
  plugin.pendingParentKeys.add('PARENT');
  await assert.rejects(plugin.processNotifierItems(), /lookup failed/);
  assert.deepEqual([...plugin.pendingParentKeys], ['PARENT']);
  assert.equal(plugin.notifierIntakeRunning, false);
});

test('intake does not overlap and schedules events received during a run', async () => {
  const { plugin } = pluginForNote(null);
  const state = { initialContentCreatedAt: '2026-01-01', units: {}, dailyQueue: null };
  let release, signalStarted;
  let scheduled = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signalStarted = resolve; });
  plugin.loadState = async () => state;
  plugin.findParent = async () => { signalStarted(); await waiting; return null; };
  plugin.forgetParent = () => false;
  plugin.unitsAPI = { pruneQueue: () => 0 };
  plugin.hasActiveReviewView = () => true;
  plugin.scheduleIntake = () => { scheduled += 1; };
  plugin.pendingParentKeys.add('FIRST');
  const first = plugin.processNotifierItems();
  await started;
  plugin.pendingParentKeys.add('SECOND');
  await plugin.processNotifierItems();
  assert.equal(plugin.notifierIntakeRunning, true);
  release();
  await first;
  assert.deepEqual([...plugin.pendingParentKeys], ['SECOND']);
  assert.equal(scheduled, 1);
});

test('unfocused source changes are coalesced without scheduling background work', async () => {
  const parent = { id: 10, key: 'PARENT', libraryID: 1, isRegularItem: () => true };
  const child = { id: 11, key: 'NOTE', libraryID: 1, parentItem: parent, isNote: () => true };
  const { plugin } = pluginForNote(null, {}, { 10: parent, 11: child });
  let scheduled = 0;
  plugin.hasActiveReviewView = () => false;
  plugin.scheduleIntake = () => { scheduled += 1; };
  await plugin.notify('modify', 'item', [11], { 11: { changed: { note: 'old' } } });
  assert.deepEqual([...plugin.pendingNotifierIDs], [11]);
  assert.equal(scheduled, 0);
  assert.equal(plugin.revision, 1);
});

test('state operations serialize mutations and publish after successful saves', async () => {
  const { plugin } = pluginForNote(null);
  const state = { initialContentCreatedAt: '2026-01-01', units: {}, dailyQueue: null };
  plugin.stateCache.set(1, state);
  plugin.loadState = async () => plugin.stateCache.get(1);
  const saved = [];
  plugin.saveState = async (_libraryID, working) => { saved.push(working.value); plugin.stateCache.set(1, working); };
  const first = plugin.withStateOperation(1, async working => { await Promise.resolve(); working.value = 1; });
  const second = plugin.withStateOperation(1, async working => { assert.equal(working.value, 1); working.value = 2; });
  await Promise.all([first, second]);
  assert.deepEqual(saved, [1, 2]);
  assert.equal(plugin.stateCache.get(1).value, 2);
});

test('saveState refuses an externally modified sync note', async () => {
  const { plugin } = pluginForNote(null);
  let html = '<pre data-review-tab-state="true">{"units":{}}</pre>';
  const note = { getNote: () => html, setNote: value => { html = value; }, saveTx: async () => {} };
  plugin.getStateNote = async () => note;
  plugin.stateNoteBaseline.set(1, '<pre data-review-tab-state="true">{"units":{}}</pre>');
  html = '<pre data-review-tab-state="true">{"units":{"external":{}}}</pre>';
  await assert.rejects(plugin.saveState(1, { units: {} }), /外部更改/);
});

test('deletion marks the view stale and requests full reconciliation for unknown IDs', async () => {
  const { plugin } = pluginForNote(null);
  plugin.scheduleIntake = () => {};
  plugin.needsFullReconcile = false;
  await plugin.notify('delete', 'item', [44]);
  assert.equal(plugin.revision, 1);
  assert.equal(plugin.needsFullReconcile, true);
  assert.ok(plugin.pendingDeletedIDs.has(44));
});

test('reload adopts resolved state and preserves cached state on malformed input', async () => {
  const { plugin } = pluginForNote(null);
  let html = '<pre data-review-tab-state="true">{"format":"review-tab-sync","version":3,"libraryID":1,"units":{}}</pre>';
  plugin.getStateNote = async () => ({ getNote: () => html });
  const original = await plugin.loadState(1);
  html = '<pre data-review-tab-state="true">{invalid</pre>';
  await assert.rejects(plugin.reloadState(1), /已停止写入/);
  assert.equal(plugin.stateCache.get(1), original);
  html = '<pre data-review-tab-state="true">{"format":"review-tab-sync","version":3,"libraryID":1,"units":{"A":{"id":"A"}}}</pre>';
  const reloaded = await plugin.reloadState(1);
  assert.equal(reloaded.units.A.id, 'A');
  assert.equal(plugin.stateNoteBaseline.get(1), html);
});

test('daily queue passes the configured backlog limits and allows zero new items', async () => {
  const { plugin } = pluginForNote(null, {
    'extensions.review-tab.dailyCount': 20,
    'extensions.review-tab.newCardLimit': 0,
    'extensions.review-tab.backlogThreshold': 15,
    'extensions.review-tab.backlogDailyLimit': 6,
    'extensions.review-tab.readingDayStartHour': 4
  });
  plugin.queueAPI = require('../queue-policy.js');
  const state = { units: { n: { id: 'n', parentKey: 'n', lane: 'new' }, b: { id: 'b', parentKey: 'b', lane: 'backlog' } }, dailyStats: {}, dailyQueue: null };
  const result = await plugin.ensureDailyQueue(state, new Date('2026-10-18T12:00:00Z'), false);
  assert.equal(result.stats.new, 0);
  assert.equal(result.stats.backlog, 1);
});

test('an existing daily queue snapshot remains stable after settings change', async () => {
  const { plugin } = pluginForNote(null);
  plugin.queueAPI = require('../queue-policy.js');
  const now = new Date('2026-10-18T12:00:00Z');
  const dayKey = plugin.queueAPI.localDayKey(now, plugin.getBoundary());
  const snapshot = { dayKey, items: [{ unitId: 'old', source: 'new', reviewedAt: null, rating: null, reviewLogRef: null, voidedAt: null }], stats: { due: 0, new: 1, backlog: 0 } };
  const state = { units: {}, dailyStats: {}, dailyQueue: snapshot };
  assert.equal(await plugin.ensureDailyQueue(state, now, false), snapshot);
  assert.equal(state.dailyQueue.items[0].unitId, 'old');
});

test('queue snapshot keeps its original boundary if the preference changes', async () => {
  const preferences = { 'extensions.review-tab.readingDayStartHour': 4, 'extensions.review-tab.dailyCount': 20, 'extensions.review-tab.newCardLimit': 4, 'extensions.review-tab.backlogThreshold': 15, 'extensions.review-tab.backlogDailyLimit': 6 };
  const { plugin } = pluginForNote(null, preferences);
  plugin.queueAPI = require('../queue-policy.js');
  const now = new Date('2026-10-18T02:00:00');
  const snapshot = plugin.queueAPI.buildQueue([{ id: 'new', parentKey: 'new', lane: 'new' }], now, 4, { total: 20, newMax: 4, backlogThreshold: 15, backlogMax: 6 });
  snapshot.items = snapshot.items.map(item => ({ ...item, reviewedAt: null, rating: null, reviewLogRef: null, voidedAt: null }));
  const state = { units: {}, dailyStats: {}, dailyQueue: snapshot };
  preferences['extensions.review-tab.readingDayStartHour'] = 0;
  assert.equal(await plugin.ensureDailyQueue(state, now, false), snapshot);
  assert.equal(state.dailyQueue.boundaryHour, 4);
});

test('invalid queue preferences fall back instead of becoming zero', () => {
  const { plugin } = pluginForNote(null, { 'extensions.review-tab.newCardLimit': '', 'extensions.review-tab.backlogThreshold': false, 'extensions.review-tab.backlogDailyLimit': '  ' });
  assert.equal(plugin.getQueueLimit('newCardLimit', 0, 30), 4);
  assert.equal(plugin.getQueueLimit('backlogThreshold', 0, 100), 15);
  assert.equal(plugin.getQueueLimit('backlogDailyLimit', 0, 30), 6);
});
