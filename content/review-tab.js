/* global Zotero */
(function () {
  const removeControlChars = value => String(value || '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  const RATINGS = [[1, '没记住'], [2, '困难'], [3, '继续'], [4, '容易']];
  const ratingLabel = rating => (RATINGS.find(item => item[0] === rating) || [0, '继续'])[1];
  const BOOK_LABEL_TYPES = new Set(['book', 'bookSection', 'encyclopediaArticle', 'manual', 'dictionaryEntry']);

  /* 条目类型标签：优先按 Zotero 条目类型区分论文 / 书籍 */
  function typeLabel(unit) {
    if (unit.unitType === 'book-session') return '书籍';
    if (unit.itemType && BOOK_LABEL_TYPES.has(unit.itemType)) return '书籍';
    return '论文';
  }

  const SORT_LABEL = { activity: '最近活动', due: '到期临近', size: '内容量', title: '标题' };
  const SORT_FNS = {
    activity: null,
    due: (a, b) => dueInDays(a) - dueInDays(b),
    size: (a, b) => (b.annotationCount + b.noteCount) - (a.annotationCount + a.noteCount),
    title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
  };

  const stripHTML = (html) => {
    return removeControlChars(String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")).replace(/\s+/g, ' ').trim();
  };

  /* 书籍批次日期：sessionDay 为 YYYY-MM-DD，显示为「2026年10月12日」 */
  function formatBatchDate(sessionDay) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sessionDay || ''));
    if (!match) return removeControlChars(sessionDay);
    return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
  }

  function noteTitle(note) {
    return removeControlChars(note.title || stripHTML(note.html).slice(0, 40) || '未命名笔记');
  }

  function dueInDays(unit) {
    if (!unit.fsrsCard) return Number.POSITIVE_INFINITY;
    const due = new Date(unit.fsrsCard.effectiveDueAt || unit.fsrsCard.due);
    return Math.round((due - new Date()) / 86400000);
  }

  function isDue(unit) {
    if (!unit.fsrsCard) return false;
    const due = new Date(unit.fsrsCard.effectiveDueAt || unit.fsrsCard.due);
    return due <= new Date();
  }

  /* 笔记 HTML 来自 Zotero 编辑器：只保留白名单标签与安全属性，再交给 DOM */
  function sanitizeNoteHTML(html, document) {
    const source = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const allowed = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'DEL', 'MARK', 'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR', 'DIV', 'SPAN', 'SUP', 'SUB', 'FIGURE', 'FIGCAPTION']);
    const safe = document.createDocumentFragment();
    function copy(node, target) {
      if (node.nodeType === node.TEXT_NODE) { target.appendChild(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== node.ELEMENT_NODE) return;
      const tag = node.tagName.toUpperCase();
      if (!allowed.has(tag)) { for (const child of node.childNodes) copy(child, target); return; }
      const element = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^(https?:|zotero:|file:)/i.test(href)) { element.setAttribute('href', href); element.setAttribute('rel', 'noopener'); }
      }
      if (tag === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (!/^(https?:|data:image\/(png|jpeg|gif|webp);|zotero:)/i.test(src)) return;
        element.setAttribute('src', src);
        element.setAttribute('alt', removeControlChars(node.getAttribute('alt')));
      }
      for (const child of node.childNodes) copy(child, element);
      target.appendChild(element);
    }
    for (const child of source.body.childNodes) copy(child, safe);
    return safe;
  }

  class ReviewTabView {
    constructor(plugin, win, container) {
      this.plugin = plugin;
      this.win = win;
      this.container = container;
      this.mode = 'today';
      this.selectedId = null;
      this.selectedNoteKey = null;
      this.dashboard = null;
      this.allItems = [];
      this.allOffset = 0;
      this.allHasMore = false;
      this.sort = 'activity';
      this.typeFilter = 'all';
      this.search = '';
      this.annotationLimit = 200;
      this.detailAnnotations = [];
      this.detailNote = null;
      this.detailError = null;
      this.detailCache = null;
      this.renderQueued = false;
      this.renderGeneration = 0;
      this.busy = false;
      this.refreshing = false;
      this.lastStateRevision = null;
      this.focusRefresh = null;
      this.destroyed = false;
      this.collapsed = { notes: false, annotations: false };
      this.keyHandler = event => this.onKeyDown(event);

      /* Zotero 标签页容器的高度取决于它的 layout；把容器设为纵向 flex，
         视图自身 flex:1）才能拿到确定高度，否则内部滚动与三栏高度都会失效 */
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.minHeight = '0';
      container.style.overflow = 'hidden';
      container.style.position = 'relative';
      const style = win.document.createElement('style');
      style.textContent = plugin.getStylesheetText();
      container.appendChild(style);
      /* 纯函数（整段文字定位、空白归一化）由插件主进程注入，和主进程共用一份实现 */
      this.imageAPI = plugin.imageAPI || { normalizeSpace: value => String(value || '').replace(/\s+/g, ' ').trim() };
      this.root = win.document.createElement('div');
      this.root.className = 'rt3-app';
      this.root.tabIndex = -1;
      container.appendChild(this.root);
      this.root.addEventListener('keydown', this.keyHandler);
      this.toastNode = win.document.createElement('div');
      this.toastNode.className = 'rt3-toast';
      this.toastNode.setAttribute('role', 'status');
      this.toastNode.setAttribute('aria-live', 'polite');
      this.root.appendChild(this.toastNode);
      this.initialize();
    }

    /* 标签页重新获得焦点：数据在失焦期间可能被增量同步改过，此时才重绘。
       没有变化时直接返回，避免整页闪动 */
    onTabFocus() {
      if (this.focusRefresh) return this.focusRefresh;
      this.focusRefresh = (async () => {
        try {
          await this.plugin.prepareView();
          if (this.destroyed) return;
          const revision = this.plugin.stateRevision();
          if (revision !== this.lastStateRevision) {
            await this.refresh(this.mode === 'all');
            this.lastStateRevision = revision;
          }
        } catch (error) { if (!this.destroyed) this.showError(error); }
      })().finally(() => { this.focusRefresh = null; });
      return this.focusRefresh;
    }

    destroy() {
      this.destroyed = true;
      this.root.removeEventListener('keydown', this.keyHandler);
      this.root.remove();
      this.container.style.display = '';
      this.container.style.flexDirection = '';
      this.container.style.minHeight = '';
      this.container.style.overflow = '';
      this.container.style.position = '';
    }

    async initialize() {
      this.root.replaceChildren(this.textNode('正在整理笔记与注释…', 'rt3-loading'), this.toastNode);
      try { await this.plugin.prepareView(); await this.refresh(true); this.lastStateRevision = this.plugin.stateRevision(); } catch (error) { this.showError(error); }
    }

    textNode(text, className = '') { const node = this.win.document.createElement('div'); node.className = className; node.textContent = text; return node; }

    element(tag, className = '', text = '') {
      const node = this.win.document.createElement(tag);
      if (className) node.className = className;
      if (text !== '') node.textContent = text;
      return node;
    }

    toast(message) {
      const node = this.toastNode;
      if (!node || !node.isConnected) return;
      node.textContent = message;
      node.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = this.win.setTimeout(() => node.classList.remove('show'), 2200);
    }

    async refresh(reset = false) {
      this.detailCache = null;
      this.renderGeneration += 1;
      try {
        if (this.mode === 'today') {
          this.dashboard = await this.plugin.getDashboard();
          if (!this.selectedId || !this.dashboard.units.some(unit => unit.id === this.selectedId)) {
            this.selectedId = this.firstPendingId(this.dashboard.units) || this.dashboard.units[0]?.id || null;
          }
        } else {
          await this.loadAll(reset);
          if (!this.selectedId || !this.allItems.some(unit => unit.id === this.selectedId)) this.selectedId = this.allItems[0]?.id || null;
        }
        await this.render();
      } catch (error) { this.showError(error); }
    }

    firstPendingId(items) { return items.find(unit => !unit.reviewedToday && !unit.paused && !unit.stopped)?.id || null; }

    async loadAll(reset) {
      if (reset) { this.allItems = []; this.allOffset = 0; this.allHasMore = false; }
      const page = await this.plugin.getRecentUnits({ offset: this.allOffset, limit: 100, sort: this.sort === 'title' ? 'added' : 'modified' });
      this.allItems.push(...page.items);
      this.allOffset = page.nextOffset;
      this.allHasMore = page.hasMore;
    }

    currentItems() {
      if (this.mode === 'today') return this.dashboard?.units || [];
      return this.filteredAllItems();
    }

    filteredAllItems() {
      const needle = this.search.trim().toLowerCase();
      let items = this.allItems.filter(unit =>
        (this.typeFilter === 'all' ? true : this.typeFilter === 'article' ? unit.unitType === 'article' : unit.unitType === 'book-session') &&
        (!needle || `${unit.title || ''} ${unit.creator || ''}`.toLowerCase().includes(needle)));
      const sortFn = SORT_FNS[this.sort];
      if (sortFn) items = items.slice().sort(sortFn);
      return items;
    }

    currentUnit() {
      if (this.mode === 'today') return this.currentItems().find(unit => unit.id === this.selectedId) || null;
      return this.allItems.find(unit => unit.id === this.selectedId) || null;
    }

    /* ---------- 渲染 ---------- */
    async render() {
      if (this.busy) { this.renderQueued = true; return; }
      this.busy = true;
      const generation = this.renderGeneration;
      try {
        const unit = this.currentUnit();
        const detail = unit ? await this.loadDetail(unit) : null;
        if (this.destroyed || generation !== this.renderGeneration) { this.renderQueued = true; return; }
        /* 注释不再自建预览：查看 PDF 交给 Zotero 自己的条目侧栏与阅读器 */
        this.selectedAnnotationKey = null;
        /* 有笔记时默认选中第一条，右栏才有内容可显示 */
        if (detail && detail.notes.length && !detail.notes.some(item => item.key === this.selectedNoteKey)) {
          this.selectedNoteKey = detail.notes[0].key;
        }
        if (detail && !detail.notes.length) this.selectedNoteKey = null;
        const note = detail && this.selectedNoteKey ? detail.notes.find(item => item.key === this.selectedNoteKey) : null;
        if (!note) this.selectedNoteKey = null;

        const fragment = this.win.document.createDocumentFragment();
        fragment.appendChild(this.renderHeader());
        const main = this.el('main', 'rt3-main');
        /* 列表 + 详情 +（有选中笔记时）笔记面板。右侧栏宽度固定，不再支持拖动 */
        main.append(this.renderListPane(), this.renderDetailPane(unit, detail));
        if (note) main.append(this.renderNotePane(note));
        fragment.appendChild(main);
        fragment.appendChild(this.toastNode);
        this.root.replaceChildren(fragment);
        /* 挂载后恢复列表滚动位置 */
        const units = this.root.querySelector('.rt3-units');
        if (units && this.listScrollTop) units.scrollTop = this.listScrollTop;
      } finally {
        this.busy = false;
        if (this.renderQueued && !this.destroyed) { this.renderQueued = false; await this.render(); }
      }
    }

    el(tag, className = '', text = '') { return this.element(tag, className, text); }

    renderHeader() {
      const header = this.el('header', 'rt3-header');
      header.appendChild(this.el('strong', '', '回顾'));
      if (this.mode === 'today' && this.dashboard) {
        const active = this.dashboard.units.filter(unit => !unit.paused && !unit.stopped);
        const done = active.filter(unit => unit.reviewedToday).length;
        const progress = this.el('div', 'rt3-progress');
        const label = this.el('span');
        const strong = this.el('b', '', String(done));
        label.append(strong, document.createTextNode(` / ${active.length}`));
        const bar = this.el('span', 'bar');
        const fill = this.el('i');
        fill.style.width = `${active.length ? Math.round((done / active.length) * 100) : 100}%`;
        bar.appendChild(fill);
        progress.append(label, bar);
        header.appendChild(progress);
        header.appendChild(this.el('span', 'rt3-stat', done >= active.length ? '今天已经看完' : `剩余 ${active.length - done}`));
      } else {
        header.appendChild(this.el('span', 'rt3-stat', `全部单元 ${this.currentItems().length}`));
      }
      header.appendChild(this.el('span', 'rt3-spacer'));
      const refresh = this.el('button', 'rt3-tool rt3-refresh', this.refreshing ? '正在刷新…' : '刷新');
      refresh.type = 'button';
      refresh.title = '重新扫描 Zotero 库，重建全部单元';
      refresh.disabled = !!this.refreshing;
      refresh.addEventListener('click', () => this.refreshLibrary());
      header.appendChild(refresh);
      const settings = this.el('button', 'rt3-tool', '设置');
      settings.type = 'button';
      settings.addEventListener('click', () => this.plugin.openPreferences());
      header.appendChild(settings);
      return header;
    }

    renderListPane() {
      const pane = this.el('aside', 'rt3-list');
      pane.setAttribute('aria-label', '单元列表');
      pane.appendChild(this.renderTabs());
      if (this.mode === 'all') pane.appendChild(this.renderTools());
      const list = this.el('div', 'rt3-units');
      const items = this.currentItems();
      if (!items.length) {
        list.appendChild(this.textNode(this.mode === 'today' ? '今天没有需要回顾的内容。' : '没有符合条件的论文或书籍。', 'rt3-empty'));
      } else if (this.mode === 'all' && this.sort === 'activity') {
        for (const bucket of this.buckets(items)) {
          list.appendChild(this.el('div', 'rt3-bucket', bucket.label));
          for (const unit of bucket.items) list.appendChild(this.renderUnitRow(unit));
        }
      } else {
        for (const unit of items) list.appendChild(this.renderUnitRow(unit));
      }
      /* 重绘后恢复滚动位置，避免选中下方条目时跳回顶部。
         首次设置发生在挂载前，布局尚未完成，因此挂载后再设一次 */
      const restore = () => {
        if (!list.isConnected) return;
        const target = this.listScrollTop || 0;
        if (list.scrollTop !== target) list.scrollTop = target;
      };
      restore();
      list.addEventListener('scroll', () => { this.listScrollTop = list.scrollTop; }, { passive: true });
      pane.appendChild(list);
      if (this.mode === 'all' && this.allHasMore) {
        const more = this.el('button', 'rt3-more', '加载更多');
        more.type = 'button';
        more.addEventListener('click', async () => { await this.loadAll(false); await this.render(); });
        pane.appendChild(more);
      }
      return pane;
    }

    renderTabs() {
      const tabs = this.el('div', 'rt3-tabs');
      tabs.setAttribute('role', 'tablist');
      for (const [mode, label] of [['today', '今日'], ['all', '全部']]) {
        const tab = this.el('button', `rt3-tab ${this.mode === mode ? 'active' : ''}`, label);
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(this.mode === mode));
        tab.addEventListener('click', () => this.switchMode(mode));
        tabs.appendChild(tab);
      }
      if (this.mode === 'all') {
        const sort = this.el('select', 'rt3-sort');
        sort.setAttribute('aria-label', '排序方式');
        for (const [value, label] of Object.entries(SORT_LABEL)) {
          const option = this.el('option', '', label);
          option.value = value;
          option.selected = value === this.sort;
          sort.appendChild(option);
        }
        sort.addEventListener('change', async () => { this.sort = sort.value; await this.render(); });
        tabs.appendChild(sort);
      }
      return tabs;
    }

    renderTools() {
      const box = this.el('div', 'rt3-tools');
      const search = this.el('input', 'rt3-search');
      search.type = 'search';
      search.placeholder = '搜索标题或作者';
      search.setAttribute('aria-label', '搜索');
      search.value = this.search;
      search.addEventListener('input', () => { this.search = search.value; this.renderListOnly(); });
      box.appendChild(search);
      const chips = this.el('div', 'rt3-chips');
      for (const [value, label] of [['all', '全部'], ['article', '论文'], ['book', '书籍']]) {
        const chip = this.el('button', `rt3-chip ${this.typeFilter === value ? 'active' : ''}`, label);
        chip.type = 'button';
        chip.addEventListener('click', () => { this.typeFilter = value; this.render(); });
        chips.appendChild(chip);
      }
      box.appendChild(chips);
      return box;
    }

    buckets(items) {
      const now = new Date();
      const dayStart = value => { const date = new Date(value); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); };
      const diff = value => Math.round((dayStart(now) - dayStart(value)) / 86400000);
      const groups = [
        { label: '今天', test: unit => diff(unit.lastActivityAt || now) === 0 },
        { label: '近三天', test: unit => { const d = diff(unit.lastActivityAt || now); return d >= 1 && d <= 2; } },
        { label: '近七天', test: unit => { const d = diff(unit.lastActivityAt || now); return d >= 3 && d <= 6; } },
        { label: '更早', test: () => true }
      ];
      const used = new Set();
      const result = [];
      for (const group of groups) {
        const bucketItems = items.filter(unit => !used.has(unit.id) && group.test(unit));
        for (const unit of bucketItems) used.add(unit.id);
        if (bucketItems.length) result.push({ label: group.label, items: bucketItems });
      }
      return result;
    }

    renderUnitRow(unit) {
      const reviewed = Boolean(unit.reviewedToday);
      const classes = ['rt3-unit'];
      if (unit.id === this.selectedId) classes.push('selected');
      if (reviewed) classes.push('reviewed');
      if (unit.paused || unit.stopped) classes.push('muted');
      const row = this.el('button', classes.join(' '));
      row.type = 'button';
      row.dataset.unit = unit.id;
      row.setAttribute('aria-pressed', String(unit.id === this.selectedId));
      row.setAttribute('aria-label', `${removeControlChars(unit.title)}${reviewed ? '，已反馈' : ''}，${unit.annotationCount || 0} 条注释，${unit.noteCount || 0} 条笔记`);
      const body = this.el('span', 'rt3-unit-body');
      const titleLine = this.el('span', 'rt3-unit-title');
      if (this.mode === 'today' && !reviewed && !unit.paused && !unit.stopped) titleLine.appendChild(this.el('i', 'rt3-dot'));
      titleLine.appendChild(document.createTextNode(removeControlChars(unit.title)));
      body.appendChild(titleLine);
      const meta = this.el('span', 'rt3-unit-meta');
      meta.appendChild(this.el('span', 'rt3-unit-author', removeControlChars(unit.creator || '未填写作者')));
      const counts = this.el('span', 'rt3-unit-counts', `${unit.annotationCount || 0} · ${unit.noteCount || 0}`);
      counts.title = `注释 ${unit.annotationCount || 0} 条 · 笔记 ${unit.noteCount || 0} 条`;
      meta.appendChild(counts);
      body.appendChild(meta);
      row.appendChild(body);
      row.addEventListener('click', () => this.selectUnit(unit.id));
      return row;
    }

    async loadDetail(unit) {
      this.detailError = null;
      const cached = this.detailCache;
      if (cached?.id === unit.id && cached.limit === this.annotationLimit) {
        this.detailNote = cached.detail;
        this.detailAnnotations = cached.detail.annotations || [];
        return cached.detail;
      }
      try {
        const detail = await this.plugin.getUnit(unit.id, { annotationOffset: 0, annotationLimit: this.annotationLimit });
        this.detailCache = { id: unit.id, limit: this.annotationLimit, detail };
        this.detailNote = detail;
        this.detailAnnotations = Array.isArray(detail.annotations) ? detail.annotations : [];
        return detail;
      } catch (error) {
        this.detailError = error;
        this.detailAnnotations = [];
        return null;
      }
    }

    renderDetailPane(unit, detail) {
      const pane = this.el('section', 'rt3-detail');
      pane.setAttribute('aria-label', '单元详情');
      if (!unit) { pane.appendChild(this.textNode('从左边选择一个单元。', 'rt3-empty')); return pane; }
      if (!detail) { pane.appendChild(this.textNode(this.detailError ? `加载详情失败：${this.detailError.message || this.detailError}` : '正在加载…', this.detailError ? 'rt3-error' : 'rt3-empty')); return pane; }
      const inner = this.el('div', 'rt3-detail-inner');
      inner.appendChild(this.renderDetailHead(detail));
      inner.appendChild(this.renderNotesSection(detail));
      inner.appendChild(this.renderAnnotationsSection());
      if (this.mode === 'today') inner.appendChild(this.renderFeedback(detail));
      const nav = this.renderNav(unit);
      if (nav) inner.appendChild(nav);
      pane.appendChild(inner);
      return pane;
    }

    renderDetailHead(detail) {
      const head = this.el('header', 'rt3-detail-head');
      const row = this.el('div', 'rt3-title-row');
      const title = this.el('h2', '', removeControlChars(detail.title));
      row.appendChild(title);
      if (detail.missing) {
        head.appendChild(row);
        return head;
      }
      const suspend = this.el('button', `rt3-icon ${detail.paused ? 'on' : ''}`, detail.paused ? '▶' : '⏸');
      suspend.type = 'button';
      suspend.setAttribute('aria-pressed', String(Boolean(detail.paused)));
      suspend.title = detail.paused ? '恢复回顾（Unsuspend）' : '暂停回顾（Suspend）';
      suspend.setAttribute('aria-label', suspend.title);
      suspend.addEventListener('click', () => this.toggleSuspend(detail));
      row.appendChild(suspend);
      head.appendChild(row);

      const meta = this.el('div', 'rt3-meta');
      const parts = [`${removeControlChars(detail.creator || '未填写作者')}${detail.year ? ` · ${removeControlChars(detail.year)}` : ''}`, typeLabel(detail)];
      /* 书籍单元按阅读日拆成批次：在详情里带出批次日期与页码范围 */
      if (detail.sessionDay) {
        parts.push(`批次 ${formatBatchDate(detail.sessionDay)}`);
        if (detail.pageRange) parts.push(`第 ${detail.pageRange.first}–${detail.pageRange.last} 页`);
      }
      meta.textContent = parts.join(' · ');
      head.appendChild(meta);

      if (this.mode === 'today') {
        const status = this.el('p', `rt3-status ${this.statusKind(detail)}`, this.statusText(detail));
        head.appendChild(status);
      }
      return head;
    }

    statusKind(unit) {
      if (unit.reviewedToday) return 'done';
      if (!unit.reviewedToday && isDue(unit)) return 'due';
      return '';
    }

    statusText(unit) {
      if (unit.paused) return '已暂停';
      if (unit.stopped) return '已学完';
      if (unit.reviewedToday) {
        const reviewed = this.dashboard?.queue?.items?.find(item => item.unitId === unit.id);
        const label = ratingLabel(reviewed?.rating || unit.queueRating);
        const days = dueInDays(unit);
        return Number.isFinite(days) && days > 0 ? `已反馈：${label} · 约 ${days} 天后再看` : `已反馈：${label}`;
      }
      if (!unit.fsrsCard) return '';
      if (isDue(unit)) return '该看了';
      return `下次大约 ${dueInDays(unit)} 天后`;
    }

    renderAnnotationsSection() {
      const open = !this.collapsed.annotations;
      const section = this.el('section', 'rt3-section');
      section.appendChild(this.renderCollapsibleHead('注释', this.detailAnnotations.length, 'annotations', () => this.toggleSection('annotations'), (head) => {
        if (this.detailNote?.hasMoreAnnotations) {
          const more = this.el('button', 'rt3-text-btn', `还有 ${Math.max(0, (this.detailNote.annotationTotal || 0) - this.detailAnnotations.length)} 条`);
          more.type = 'button';
          more.title = '显示更多注释';
          more.addEventListener('click', () => this.loadMoreAnnotations());
          head.appendChild(more);
        }
      }));
      if (!open) return section;
      if (!this.detailAnnotations.length) {
        section.appendChild(this.textNode('没有 PDF 注释。', 'rt3-empty'));
        return section;
      }
      /* 按页分组，逐条列出；不再有截图，也就不需要「续排片段」的并排排版 */
      for (const row of this.annotationLayout(this.detailAnnotations)) {
        section.appendChild(this.el('div', 'rt3-page', row.page ? '第 ' + row.page + ' 页' : '未标页码'));
        for (const annotation of row.items) section.appendChild(this.renderAnnotation(annotation));
      }
      return section;
    }

    /* 注释排布：按页分组，组内保持原有顺序（hydrateUnit 的 SQL 已按页、页内位置排好）。
       截图移除后不再需要「续排片段」的纵向重叠合并，每条注释独占一行 */
    annotationLayout(annotations) {
      const rounds = [];
      for (const annotation of annotations) {
        const page = annotation.pageLabel || '';
        const last = rounds[rounds.length - 1];
        if (last && last.page === page) last.items.push(annotation);
        else rounds.push({ page, items: [annotation] });
      }
      return rounds;
    }

    /* 可折叠分区标题：箭头 + 名称 + 计数 + 右侧操作 */
    renderCollapsibleHead(title, count, key, onToggle, decorate) {
      const head = this.el('div', 'rt3-section-head');
      const open = !this.collapsed[key];
      const toggle = this.el('button', 'rt3-toggle');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? '收起' : '展开';
      toggle.appendChild(this.el('i', 'caret', open ? '▾' : '▸'));
      toggle.appendChild(document.createTextNode(title));
      toggle.addEventListener('click', onToggle);
      head.appendChild(toggle);
      head.appendChild(this.el('span', 'count', String(count)));
      head.appendChild(this.el('span', 'spacer'));
      if (decorate) decorate(head);
      return head;
    }

    async toggleSection(key) {
      this.collapsed[key] = !this.collapsed[key];
      await this.render();
    }

    /* 一条注释：色条 + 文字或批注 + 操作。
       截图与悬停放大已移除，只看文字；「原文」直接在 Zotero 阅读器中定位 */
    renderAnnotation(annotation) {
      const node = this.el('article', 'rt3-ann');
      node.dataset.key = annotation.key || '';
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', this.annotationLabel(annotation));
      const color = this.el('i', 'rt3-swatch');
      color.style.background = /^#[0-9a-f]{3,8}$/i.test(annotation.color || '') ? annotation.color : 'var(--fill-quaternary)';
      node.appendChild(color);
      const body = this.el('div', 'rt3-ann-body');
      if (annotation.text) body.appendChild(this.el('p', 'rt3-ann-text', removeControlChars(annotation.text)));
      else if (annotation.ink) body.appendChild(this.el('p', 'rt3-ann-kind', this.annotationLabel(annotation)));
      if (annotation.comment) body.appendChild(this.el('p', 'rt3-ann-comment', removeControlChars(annotation.comment)));
      node.appendChild(body);
      if (annotation.key) {
        const actions = this.el('div', 'rt3-ann-actions');
        const open = this.el('button', 'rt3-text-btn', '原文');
        open.type = 'button';
        open.title = '在 PDF 中阅读';
        open.addEventListener('click', event => { event.stopPropagation(); this.plugin.openAnnotation(annotation.key, this.plugin.tabID); });
        actions.appendChild(open);
        node.appendChild(actions);
      }
      return node;
    }

    annotationLabel(annotation) {
      const type = this.plugin.annotationTypeLabel(annotation.type);
      if (annotation.ink) return '手写批注';
      return type;
    }

    async loadMoreAnnotations() {
      const detail = this.detailNote;
      const unitId = this.selectedId;
      const generation = this.renderGeneration;
      if (!detail || !unitId || !detail.hasMoreAnnotations || this.loadingMoreAnnotations) return;
      const offset = this.detailAnnotations.length;
      this.loadingMoreAnnotations = true;
      try {
        const page = await this.plugin.getUnit(unitId, { annotationOffset: offset, annotationLimit: 200 });
        if (this.destroyed || this.selectedId !== unitId || this.renderGeneration !== generation) return;
        const known = new Set(this.detailAnnotations.map(annotation => annotation.key));
        const annotations = this.detailAnnotations.concat((page?.annotations || []).filter(annotation => !known.has(annotation.key)));
        this.annotationLimit = annotations.length;
        this.detailNote = Object.assign({}, detail, page, { annotations });
        this.detailAnnotations = annotations;
        this.detailCache = { id: unitId, limit: this.annotationLimit, detail: this.detailNote };
        this.renderGeneration += 1;
        await this.render();
      } catch (error) {
        if (!this.destroyed && this.selectedId === unitId) this.showInlineError(error);
      } finally { this.loadingMoreAnnotations = false; }
    }

    renderNotesSection(detail) {
      const open = !this.collapsed.notes;
      const section = this.el('section', 'rt3-section');
      section.appendChild(this.renderCollapsibleHead('笔记', detail.notes.length, 'notes', () => this.toggleSection('notes'), (head) => {
        const create = this.el('button', 'rt3-text-btn', '新建');
        create.type = 'button';
        create.addEventListener('click', () => this.plugin.newNote(detail.parentRef));
        head.appendChild(create);
      }));
      if (!open) return section;
      if (!detail.notes.length) {
        section.appendChild(this.textNode('还没有条目笔记。', 'rt3-empty'));
        return section;
      }
      for (const note of detail.notes) {
        const selected = this.selectedNoteKey === note.key;
        const item = this.el('button', selected ? 'rt3-note-item selected' : 'rt3-note-item');
        item.type = 'button';
        item.setAttribute('aria-pressed', String(selected));
        item.appendChild(this.el('span', '', noteTitle(note)));
        item.addEventListener('click', () => this.openNote(note.key));
        section.appendChild(item);
      }
      return section;
    }

    renderNotePane(note) {
      const pane = this.el('section', 'rt3-note-pane');
      pane.setAttribute('aria-label', '笔记内容');
      const head = this.el('div', 'rt3-note-head');
      /* 在 Zotero 中打开：固定在标题左侧 */
      const open = this.el('button', 'rt3-icon', '↗');
      open.type = 'button';
      open.title = '在 Zotero 中打开';
      open.setAttribute('aria-label', '在 Zotero 中打开笔记');
      open.addEventListener('click', () => this.plugin.openNote(note.key));
      head.appendChild(open);
      head.appendChild(this.el('span', 'title', noteTitle(note)));
      pane.appendChild(head);
      const body = this.el('div', 'rt3-note-body');
      const content = this.el('div', 'rt3-note-content');
      content.appendChild(sanitizeNoteHTML(note.html, this.win.document));
      body.appendChild(content);
      pane.appendChild(body);
      return pane;
    }
    renderFeedback(detail) {
      const section = this.el('section', 'rt3-feedback');
      section.setAttribute('aria-label', 'FSRS 反馈');
      const head = this.el('div', 'rt3-section-head');
      head.appendChild(this.el('h3', '', '这次记得怎么样'));
      head.appendChild(this.el('span', 'spacer'));
      const active = this.currentItems().filter(unit => !unit.paused && !unit.stopped);
      const index = active.findIndex(unit => unit.id === detail.id);
      if (index >= 0) head.appendChild(this.el('span', 'count', `${index + 1} / ${active.length}`));
      section.appendChild(head);
      const grades = this.el('div', 'rt3-grades');
      const reviewed = this.dashboard?.queue?.items?.find(item => item.unitId === detail.id);
      for (const [rating, label] of RATINGS) {
        const button = this.el('button', reviewed?.reviewedAt && reviewed.rating === rating ? 'picked' : '', label);
        button.type = 'button';
        button.dataset.rating = String(rating);
        button.setAttribute('aria-pressed', String(Boolean(reviewed?.reviewedAt && reviewed.rating === rating)));
        button.addEventListener('click', () => this.grade(detail.id, rating));
        grades.appendChild(button);
      }
      section.appendChild(grades);
      return section;
    }

    /* 上一条 / 下一条：今日与全部都显示，首尾循环，不排除已暂停的单元 */
    renderNav(unit) {
      const items = this.currentItems();
      if (!items.length) return null;
      const nav = this.el('div', 'rt3-nav');
      const index = items.findIndex(item => item.id === unit.id);
      const prev = index > 0 ? items[index - 1] : items[items.length - 1];
      const next = index >= 0 && index < items.length - 1 ? items[index + 1] : items[0];
      if (prev && prev.id !== unit.id) {
        const button = this.el('button', 'rt3-btn', '← 上一条');
        button.type = 'button';
        button.title = removeControlChars(prev.title);
        button.addEventListener('click', () => this.selectUnit(prev.id));
        nav.appendChild(button);
      }
      if (next && next.id !== unit.id) {
        nav.appendChild(this.el('span', 'name', removeControlChars(next.title)));
        const button = this.el('button', 'rt3-btn', '下一条 →');
        button.type = 'button';
        button.title = '跳到下一条';
        button.addEventListener('click', () => this.selectUnit(next.id));
        nav.appendChild(button);
      }
      return nav.childNodes.length ? nav : null;
    }

    /* 仅更新列表，避免整页重绘打断输入 */
    renderListOnly() {
      const current = this.root.querySelector('.rt3-list');
      if (!current) return this.render();
      const next = this.renderListPane();
      current.replaceWith(next);
    }

    /* ---------- 操作 ---------- */
    /* 手动刷新：全量重建状态后重绘。重建期间禁用按钮并显示进行中 */
    async refreshLibrary() {
      if (this.refreshing) return;
      this.refreshing = true;
      await this.render();
      try {
        await this.plugin.refreshAllContent();
        /* 选中项可能已被删除，回到队列首条 */
        const items = this.currentItems();
        if (!items.some(unit => unit.id === this.selectedId)) this.selectedId = items[0]?.id || null;
          this.toast('已重新扫描 Zotero 库');
      } catch (error) {
        this.showInlineError(error);
      } finally {
        this.refreshing = false;
        await this.refresh(false);
      }
    }

    async selectUnit(id) {
      this.selectedId = id;
      this.detailCache = null;
      this.renderGeneration += 1;
      this.selectedAnnotationKey = null;
      this.annotationLimit = 200;
      this.detailAnnotations = [];
      /* 页面图按注释 key 缓存，换单元不清空，来回切换不用重新渲染 */
      await this.render();
    }

    async switchMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      this.selectedAnnotationKey = null;
      this.detailCache = null;
      this.renderGeneration += 1;
      this.selectedId = null;
      this.selectedNoteKey = null;
      /* 切换视图时列表回到顶部 */
      this.listScrollTop = 0;
      await this.refresh(true);
    }

    async openNote(key) {
      this.selectedNoteKey = key;
      await this.render();
    }

    /* 反馈：同一档再点一次撤销；成功后跳到下一条未反馈的单元 */
    async grade(id, rating) {
      const item = this.dashboard?.queue?.items?.find(entry => entry.unitId === id);
      const isUndo = Boolean(item?.reviewedAt && !item.voidedAt && item.rating === rating);
      try {
        if (isUndo) await this.plugin.undoTodayRating(id);
        else await this.plugin.gradeUnit(id, rating);
      } catch (error) {
        this.showInlineError(error);
        return;
      }
      this.toast(isUndo ? '已撤销反馈' : `已记录：${ratingLabel(rating)}`);
      await this.refresh(false);
    }

    async toggleSuspend(unit) {
      try {
        await this.plugin.setUnitFlag(unit.id, { paused: !unit.paused });
      } catch (error) {
        this.showInlineError(error);
        return;
      }
      this.toast(unit.paused ? '已恢复回顾' : '已暂停回顾（Suspend）');
      await this.refresh(false);
    }

    /* 下一条待反馈单元（反馈后自动跳转用）：未反馈、未暂停，队列首尾循环 */
    nextUnit() {
      const items = this.currentItems();
      if (!items.length) return null;
      const index = items.findIndex(item => item.id === this.selectedId);
      const rest = index < 0 ? items : items.slice(index + 1).concat(items.slice(0, index));
      return rest.find(item => !item.reviewedToday && !item.paused && !item.stopped) || null;
    }

    onKeyDown(event) {
      if (event.target.closest && event.target.closest('input, textarea, select')) return;
      if (this.mode !== 'today') return;
      const unit = this.currentUnit();
      if (!unit || unit.paused) return;
      if (/^[1-4]$/.test(event.key)) {
        event.preventDefault();
        this.grade(unit.id, Number(event.key));
      }
    }

    showInlineError(error) {
      this.toast(`操作失败：${error?.message || error}`);
      Zotero.logError(error);
    }

    showError(error) {
      this.root.replaceChildren(this.textNode(`无法加载回顾内容：${error?.message || error}`, 'rt3-error'), this.toastNode);
      Zotero.logError(error);
    }
  }

  window.ReviewTabView = ReviewTabView;
}());

























