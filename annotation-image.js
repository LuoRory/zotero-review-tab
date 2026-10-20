/* 注释图片预览的纯函数部分：不依赖 Zotero / DOM，可在 Node 里直接测试。
   - imageBase64：Zotero 图片注释存的是整页渲染图（data:image/png;base64,…）。
     position.rects 给出区域在整页中的坐标（CSS px，页面宽度 1000px），
     用矩形把需要的部分裁出来，比整页缩略图更省内存、更清楚。
   - snippet：在 PDF 文字层里定位高亮片段，用来在预览里标出「这句话在原文哪一段」。 */
(function (root) {
  /* Zotero 用宽 1000 的渲染图记录注释坐标；注释截图按 4000px 宽渲染后裁出，
     即同一坐标系放大 4 倍（矩形宽 100 ≈ 截图宽 400px） */
  const DEFAULT_PAGE_RENDER_WIDTH = 1000;
  const CACHE_IMAGE_SCALE = 4;
  const MAX_SNIPPET_LENGTH = 200;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /* annotationPosition 可能是对象（Zotero 8 起）也可能是 JSON 字符串（Zotero 7 库里读出来的原始值） */
  function parsePosition(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  /* 注释区域矩形（CSS px，基于页面宽 1000px 的渲染图）。越界、空矩形返回 null */
  function pageRects(annotation) {
    const position = annotation && annotation.position ? annotation.position : parsePosition(annotation && annotation.annotationPosition);
    const raw = position && Array.isArray(position.rects) ? position.rects : [];
    const rects = [];
    for (const rect of raw) {
      if (!Array.isArray(rect) || rect.length < 4) continue;
      const values = rect.slice(0, 4).map(Number);
      if (!values.every(Number.isFinite)) continue;
      const [x1, y1, x2, y2] = values;
      const left = Math.min(x1, x2); const right = Math.max(x1, x2);
      const top = Math.min(y1, y2); const bottom = Math.max(y1, y2);
      if (right - left < 0.5 || bottom - top < 0.5) continue;
      rects.push({ left, top, right, bottom });
    }
    return rects.length ? rects : null;
  }

  /* 把生成的 SVG 变成 <img src> 可用的 data URI：encodeURIComponent 会处理引号、
     非 ASCII 字符与 #，避免属性引号被当作文本渲染出来 */
  function svgDataURL(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg || ''))}`;
  }

  /* 页面内的区域遮罩：在 (width × height) 的坐标系里挖掉 all 矩形之外的像素。
     图片注释的缓存图并不总是精确裁剪（旧版缓存可能是整页，选区调整后也不会重裁），
     用「hidden」遮罩叠在图上，过大的部分被盖住、过小的部分自然露白，两种情况下都只显示区域本身。
     整页宽 1000 时矩形坐标就是遮罩坐标；否则传入缩放系数 */
  function regionMaskSVG(width, height, rects, { scale = 1, dimColor = '#ffffff' } = {}) {
    const round = value => Math.round(value * 10) / 10;
    const holes = (Array.isArray(rects) ? rects : [])
      .filter(rect => rect.right > rect.left && rect.bottom > rect.top)
      .map(rect => ({ left: rect.left * scale, top: rect.top * scale, right: rect.right * scale, bottom: rect.bottom * scale }))
      .map(rect => `M${round(rect.left)} ${round(rect.top)}H${round(rect.right)}V${round(rect.bottom)}H${round(rect.left)}Z`);
    const outer = `M0 0H${round(width)}V${round(height)}H0Z`;
    return { width: round(width), height: round(height), svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}"><path d="${outer} ${holes.join('')}" fill-rule="evenodd" fill="${dimColor}"/></svg>` };
  }

  /* 外接矩形 + 边距：裁剪整页渲染图时用。padding 相对页面宽度换算 */
  function boundingBox(rects, { paddingRatio = 0.03, pageWidth = DEFAULT_PAGE_RENDER_WIDTH } = {}) {
    if (!Array.isArray(rects) || !rects.length) return null;
    const pad = Math.max(4, Math.round(pageWidth * paddingRatio));
    return {
      left: Math.min(...rects.map(rect => rect.left)) - pad,
      top: Math.min(...rects.map(rect => rect.top)) - pad,
      right: Math.max(...rects.map(rect => rect.right)) + pad,
      bottom: Math.max(...rects.map(rect => rect.bottom)) + pad
    };
  }

  /* 生成可在 <img> 里显示的 SVG（图片注释区域预览：整页截图 + 区域外压暗）。
     只输出坐标和颜色，不含任何用户 HTML，直接作为 data:image/svg+xml 使用。
     没有区域矩形时整张压暗，也能看清截图内容 */
  function regionSVG(width, height, box, { padding = 12, dimColor = '#000', dimOpacity = 0.55 } = {}) {
    const round = value => Math.round(value * 10) / 10;
    const holes = Array.isArray(box) ? box.filter(item => item.right > item.left && item.bottom > item.top) : [];
    const outer = `M0 0H${width}V${height}H0Z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + (holes.length
        ? `<path d="${outer} ${holes.map(hole => `M${round(hole.left)} ${round(hole.top)}H${round(hole.right)}V${round(hole.bottom)}H${round(hole.left)}Z`).join('')}" fill-rule="evenodd" fill="${dimColor}" fill-opacity="${dimOpacity}"/>`
        : `<rect width="${width}" height="${height}" fill="${dimColor}" fill-opacity="${dimOpacity}"/>`)
      + `</svg>`;
    return { width: width + padding * 2, height: height + padding * 2, svg, padding };
  }

  /* 高亮片段：高亮本身没有文字时，取它后面同一行（或下一行）的文字，供预览里定位上下文。
     结果长度上限 200，超出不截断——宁可不预览，也不显示半句话 */
  function snippetCandidate(annotation) {
    if (!annotation) return null;
    for (const value of [annotation.highlightText, annotation.text]) {
      const text = normalizeSpace(value);
      if (text && text.length <= MAX_SNIPPET_LENGTH) return text;
    }
    return null;
  }

  function normalizeSpace(value) {
    return String(value || '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* 在文字里找片段：忽略空白与大小写的差异（PDF 文字层常把单词拆开、句尾合并）。
     取最后一次出现的位置——通常比第一次更接近用户真正划线的地方。找不到返回 null */
  function findSnippet(text, snippet) {
    const haystack = String(text || '');
    const needle = normalizeSpace(snippet);
    if (!needle) return null;
    /* 把 needle 按空白切开，中间允许任意空白 */
    const pattern = needle.split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    let regex;
    try { regex = new RegExp(pattern, 'gi'); } catch (_) { return null; }
    let match; let last = null;
    while ((match = regex.exec(haystack))) last = match;
    if (!last) return null;
    const start = last.index; const end = start + last[0].length;
    return { start, end, before: contextBefore(haystack, start), after: contextAfter(haystack, { start, end }) };
  }

  function contextBefore(text, index) {
    const prefix = text.slice(0, index);
    const breakAt = Math.max(prefix.lastIndexOf('。'), prefix.lastIndexOf('.'), prefix.lastIndexOf('；'), prefix.lastIndexOf(';'), prefix.lastIndexOf('\n'));
    return normalizeSpace(breakAt >= 0 ? prefix.slice(breakAt + 1) : prefix);
  }

  /* 后半句从片段结束处开始取，避免预览里把片段重复一遍 */
  function contextAfter(text, matched) {
    const suffix = text.slice(matched.end);
    const stops = ['.', '。', '\n', ';', '；'].map(char => suffix.indexOf(char)).filter(pos => pos >= 0);
    const stopAt = stops.length ? Math.min(...stops) + 1 : suffix.length;
    return normalizeSpace(suffix.slice(0, stopAt));
  }

  /* 预览 HTML：只接受已转义好的片段文本，高亮部分用 <mark> 包起来 */
  function previewHTML({ before, mark, after }) {
    const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    return `<p class="rt3-ctx">…${escape(before)}<mark>${escape(mark)}</mark>${escape(after)}…</p>`;
  }

  /* 页内垂直位置：矩形顶边相对页面高度，用来排序图片注释与定位标签 */
  function pagePosition(annotation) {
    const rects = pageRects(annotation);
    if (!rects) return null;
    return { top: Math.min(...rects.map(rect => rect.top)), left: Math.min(...rects.map(rect => rect.left)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
  }

  const api = {
    DEFAULT_PAGE_RENDER_WIDTH,
    CACHE_IMAGE_SCALE,
    MAX_SNIPPET_LENGTH,
    clamp,
    parsePosition,
    pageRects,
    regionMaskSVG,
    svgDataURL,
    boundingBox,
    regionSVG,
    snippetCandidate,
    normalizeSpace,
    findSnippet,
    previewHTML,
    pagePosition
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.ReviewTabAnnotationImage = api;
}(this));
