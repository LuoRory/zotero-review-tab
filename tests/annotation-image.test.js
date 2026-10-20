const test = require('node:test');
const assert = require('node:assert/strict');
const image = require('../annotation-image.js');

test('regionMaskSVG hides everything outside the rects and scales rects', () => {
  const mask = image.regionMaskSVG(1000, 1400, [{ left: 100, top: 200, right: 300, bottom: 260 }]);
  assert.equal(mask.width, 1000);
  assert.match(mask.svg, /M0 0H1000V1400H0Z M100 200H300V260H100Z/);
  assert.match(mask.svg, /fill-rule="evenodd"/);
  const scaled = image.regionMaskSVG(564, 120, [{ left: 28, top: 10, right: 310, bottom: 60 }], { scale: 2 });
  assert.match(scaled.svg, /M56 20H620V120H56Z/);
  const empty = image.regionMaskSVG(10, 10, null);
  assert.match(empty.svg, /d="M0 0H10V10H0Z "/);
});

test('parsePosition accepts both object and JSON-string annotation positions', () => {
  assert.deepEqual(image.parsePosition({ pageIndex: 2, rects: [] }), { pageIndex: 2, rects: [] });
  assert.deepEqual(image.parsePosition('{"pageIndex":1,"rects":[[1,2,3,4]]}'), { pageIndex: 1, rects: [[1, 2, 3, 4]] });
  assert.deepEqual(image.parsePosition('not json'), {});
  assert.deepEqual(image.parsePosition(null), {});
});

test('pageRects reads the raw annotationPosition string too', () => {
  const rects = image.pageRects({ annotationPosition: '{"pageIndex":0,"rects":[[10,20,30,40]]}' });
  assert.deepEqual(rects, [{ left: 10, top: 20, right: 30, bottom: 40 }]);
});

test('pageRects normalizes rect order and drops degenerate rects', () => {
  const rects = image.pageRects({ position: { rects: [[40, 120, 90, 80], [5, 5, 5, 9], ['a', 1, 2, 3]] } });
  assert.deepEqual(rects, [{ left: 40, top: 80, right: 90, bottom: 120 }]);
  assert.equal(image.pageRects({ position: { rects: [] } }), null);
  assert.equal(image.pageRects({}), null);
  assert.equal(image.pageRects(null), null);
});

test('boundingBox adds a page-relative margin and covers every rect', () => {
  const box = image.boundingBox([{ left: 100, top: 200, right: 300, bottom: 260 }, { left: 90, top: 270, right: 320, bottom: 300 }], { paddingRatio: 0.03 });
  assert.deepEqual(box, { left: 60, top: 170, right: 350, bottom: 330 });
  assert.equal(image.boundingBox([]), null);
});

test('regionSVG dims everything outside the region and never embeds raw text', () => {
  const result = image.regionSVG(800, 400, [{ left: 100, top: 50, right: 300, bottom: 150 }], { padding: 10 });
  const path = /<path d="([^"]+)" fill-rule="evenodd"/.exec(result.svg)[1];
  assert.match(path, /^M0 0H800V400H0Z /);
  assert.match(path, /M100 50H300V150H100Z/);
  assert.equal(result.width, 820);
  assert.equal(result.height, 420);
  const bare = image.regionSVG(10, 10, null);
  assert.match(bare.svg, /<rect width="10" height="10"/);
  assert.equal(bare.svg.includes('<'), true);
  assert.equal(/<script/i.test(bare.svg), false);
});

test('snippetCandidate prefers highlighted text and refuses over-long snippets', () => {
  assert.equal(image.snippetCandidate({ highlightText: '  实体几何表示 ', text: 'CSG' }), '实体几何表示');
  assert.equal(image.snippetCandidate({ highlightText: '', text: 'CSG' }), 'CSG');
  assert.equal(image.snippetCandidate({ highlightText: 'x'.repeat(201) }), null);
  assert.equal(image.snippetCandidate(null), null);
});

test('findSnippet matches across line breaks and case, preferring the last match', () => {
  const text = 'The CSG model represents solids.\nThe CSG   model is compact.\nNext paragraph.';
  const found = image.findSnippet(text, 'the csg model');
  assert.ok(found);
  assert.equal(text.slice(found.start, found.end), 'The CSG   model');
  assert.equal(found.before, '');
  assert.equal(image.findSnippet('nothing here', '实体几何'), null);
  assert.equal(image.findSnippet(text, ''), null);
  assert.equal(image.findSnippet(text, 'a+b'), null);
});

test('findSnippet collects sentence context around the match', () => {
  const text = '第一句在这里。实体几何表示（CSG）用布尔运算组合基本体。最后一句。';
  const found = image.findSnippet(text, '布尔运算');
  assert.equal(found.before, '实体几何表示（CSG）用');
  /* before 在片段前止住，片段本身由 <mark> 呈现，after 从片段之后开始 */
  assert.equal(found.after, '组合基本体。');
});

test('previewHTML escapes user text and keeps the mark element', () => {
  const html = image.previewHTML({ before: 'a <b>', mark: '实体 & 几何', after: '"x"' });
  assert.equal(html, '<p class="rt3-ctx">…a &lt;b&gt;<mark>实体 &amp; 几何</mark>&quot;x&quot;…</p>');
});

test('pagePosition reports the top-most edge of the annotation', () => {
  assert.deepEqual(image.pagePosition({ position: { rects: [[10, 30, 20, 40], [5, 10, 15, 12]] } }), { top: 10, left: 5, bottom: 40 });
  assert.equal(image.pagePosition({}), null);
});
