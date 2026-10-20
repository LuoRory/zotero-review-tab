const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function viewPrototype() {
  const window = {};
  const context = { window, Zotero: { logError() {} }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'content/review-tab.js'), 'utf8'), context);
  return window.ReviewTabView.prototype;
}

test('late annotation pages never get appended to a different selected unit', async () => {
  let resolve;
  const view = Object.create(viewPrototype());
  Object.assign(view, {
    plugin: { getUnit: () => new Promise(done => { resolve = done; }) },
    detailNote: { hasMoreAnnotations: true }, selectedId: 'A', renderGeneration: 1,
    detailAnnotations: [{ key: 'A1' }], destroyed: false, render: async () => {}, showInlineError: () => {}
  });
  const pending = view.loadMoreAnnotations();
  view.selectedId = 'B'; view.renderGeneration += 1;
  view.detailAnnotations = [{ key: 'B1' }];
  resolve({ annotations: [{ key: 'A2' }], hasMoreAnnotations: false });
  await pending;
  assert.deepEqual(view.detailAnnotations, [{ key: 'B1' }]);
  assert.equal(view.loadingMoreAnnotations, false);
});
