/* global Zotero, Services, Ci, Cc, Components, APP_SHUTDOWN */
var ReviewTabChromeHandle;
var ReviewTabPlugin = {
  id: 'review-tab@local.zotero',
  rootURI: null,
  stopped: false,
  initializationPromises: new Map(),
  stateCache: new Map(),
  stateNoteIDs: new Map(),
  stateSaveQueues: new Map(),
  stateOperationQueues: new Map(),
  stateNoteBaseline: new Map(),
  tabViews: new WeakMap(),
  readerReturnTabs: new Map(),
  notifierID: null,
  notifierTimer: null,
  pendingNotifierIDs: new Set(),
  pendingDeletedIDs: new Set(),
  pendingParentKeys: new Set(),
  notifierIntakeRunning: false,
  needsFullReconcile: true,
  viewsStale: false,
  revision: 0,
  /* 子条目（笔记 / 注释）itemID → 父条目 key，删除事件时用来回溯归属 */
  childParents: new Map(),
  syncNoteTitle: 'Review Tab — Sync State',
  prefs: {
    enabled: 'extensions.review-tab.enabled',
    openOnStartup: 'extensions.review-tab.openOnStartup',
    dailyCount: 'extensions.review-tab.dailyCount',
    newCardLimit: 'extensions.review-tab.newCardLimit',
    backlogThreshold: 'extensions.review-tab.backlogThreshold',
    backlogDailyLimit: 'extensions.review-tab.backlogDailyLimit',
    boundary: 'extensions.review-tab.readingDayStartHour',
    firstDays: 'extensions.review-tab.firstReviewDays'
  },
  prefDefaults: { enabled: true, openOnStartup: true, dailyCount: 20, newCardLimit: 4, backlogThreshold: 15, backlogDailyLimit: 6, boundary: 4, firstDays: 3 },

  debug(message, data) { try { Zotero.debug(`[Review Tab] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`); } catch (_) {} },
  report(error, context) { this.debug(`ERROR ${context}`, { message: error?.message || String(error) }); try { Zotero.logError(error); } catch (_) {} },
  performance(start, phase, counts = {}) {
    if (Zotero.Prefs.get('extensions.review-tab.performanceDiagnostics', true) !== true) return;
    this.debug('PERFORMANCE', Object.assign({ phase, elapsedMs: Date.now() - start }, counts));
  },
  getPref(name) { const value = Zotero.Prefs.get(this.prefs[name], true); return value === undefined || value === null ? this.prefDefaults[name] : value; },
  getBoundary() { const value = Number(this.getPref('boundary')); return Number.isInteger(value) && value >= 0 && value <= 23 ? value : this.prefDefaults.boundary; },
  getQueueLimit(name, minimum, maximum) {
    const raw = this.getPref(name);
    const validString = typeof raw === 'string' && /^(0|[1-9]\d*)$/.test(raw);
    const value = typeof raw === 'number' || validString ? Number(raw) : NaN;
    return Number.isInteger(value) && value >= minimum && value <= maximum ? value : this.prefDefaults[name];
  },
  ensureDefaultPreferences() { for (const [name, value] of Object.entries(this.prefDefaults)) if (Zotero.Prefs.get(this.prefs[name], true) === undefined) Zotero.Prefs.set(this.prefs[name], value, true); },

  startup(data) {
    try {
      this.id = data.id || this.id;
      this.rootURI = data.rootURI || data.resourceURI?.spec || '';
      const service = (typeof Cc !== 'undefined' ? Cc : Components.classes)['@mozilla.org/addons/addon-manager-startup;1'].getService((typeof Ci !== 'undefined' ? Ci : Components.interfaces).amIAddonManagerStartup);
      ReviewTabChromeHandle = service.registerChrome(Services.io.newURI(this.rootURI + 'manifest.json'), [['content', 'reviewtab', this.rootURI + 'content/']]);
      Services.scriptloader.loadSubScript(this.rootURI + 'build-info.js', this);
      Services.scriptloader.loadSubScript(this.rootURI + 'schedule.js', this);
      Services.scriptloader.loadSubScript(this.rootURI + 'discovery.js', this);
      Services.scriptloader.loadSubScript(this.rootURI + 'annotation-image.js', this);
      Services.scriptloader.loadSubScript(this.rootURI + 'queue-policy.js', this);
      Services.scriptloader.loadSubScript(this.rootURI + 'unit-maintenance.js', this);
      Services.scriptloader.loadSubScript(this.rootURI + 'vendor/ts-fsrs-5.4.2.umd.js', this);
      this.FSRS = this.FSRS || globalThis.FSRS;
      Services.scriptloader.loadSubScript(this.rootURI + 'fsrs-adapter.js', this);
      const modules = { schedule: !!this.ReviewTabSchedule, discovery: !!this.ReviewTabDiscovery, images: !!this.ReviewTabAnnotationImage, queue: !!this.ReviewTabQueue, maintenance: !!this.ReviewTabUnits, fsrs: !!this.FSRS, adapter: !!this.ReviewTabFSRS };
      if (!modules.schedule || !modules.discovery || !modules.images || !modules.queue || !modules.maintenance || !modules.fsrs || !modules.adapter) throw new Error(`Required scheduling module failed to load: ${JSON.stringify(modules)}`);
      this.scheduleAPI = this.ReviewTabSchedule;
      this.discoveryAPI = this.ReviewTabDiscovery;
      this.imageAPI = this.ReviewTabAnnotationImage;
      this.queueAPI = this.ReviewTabQueue;
      this.unitsAPI = this.ReviewTabUnits;
      this.fsrsAPI = this.ReviewTabFSRS;
      this.stopped = false;
      Promise.all([Zotero.initializationPromise || Promise.resolve(), Zotero.unlockPromise || Promise.resolve(), Zotero.uiReadyPromise || Promise.resolve()]).then(() => {
        if (this.stopped) return;
        this.ensureDefaultPreferences();
        this.registerPreferences();
        this.notifierID = Zotero.Notifier.registerObserver(this, ['item', 'tab'], 'ReviewTabPlugin');
        this.addToAllWindows();
        this.debug('READY', { rootURI: this.rootURI });
      }).catch(error => this.report(error, 'startup readiness'));
    } catch (error) { this.report(error, 'startup'); }
  },
  shutdown(_data, reason) {
    this.stopped = true;
    clearTimeout(this.notifierTimer);
    if (this.notifierID) try { Zotero.Notifier.unregisterObserver(this.notifierID); } catch (error) { this.report(error, 'shutdown notifier'); }
    for (const win of Zotero.getMainWindows()) this.removeFromWindow(win);
    this.stateCache.clear(); this.stateNoteIDs.clear(); this.stateSaveQueues.clear(); this.stateOperationQueues.clear(); this.stateNoteBaseline.clear(); this.initializationPromises.clear();
    this.pendingNotifierIDs.clear(); this.pendingDeletedIDs.clear(); this.pendingParentKeys.clear(); this.notifierIntakeRunning = false;
    if (reason !== APP_SHUTDOWN) ReviewTabChromeHandle?.destruct();
    ReviewTabChromeHandle = undefined;
  },
  install() {}, uninstall() {},
  onMainWindowLoad({ window }) { this.addToWindow(window); },
  onMainWindowUnload({ window }) { this.removeFromWindow(window); },

  registerPreferences() { try { Zotero.PreferencePanes.register({ pluginID: this.id, src: this.rootURI + 'content/preferences.xhtml', label: 'Review Tab' }); } catch (error) { this.report(error, 'preferences'); } },
  addToAllWindows() { for (const win of Zotero.getMainWindows()) this.addToWindow(win); },
  addToWindow(win) {
    if (!win || win.__reviewTabInstalled) return;
    win.__reviewTabInstalled = true;
    const menu = win.document.getElementById('menu_ToolsPopup') || win.document.getElementById('menu_Tools');
    if (menu) { const item = win.document.createXULElement('menuitem'); item.id = 'review-tab-tools-menu'; item.setAttribute('label', '打开回顾标签页'); item.addEventListener('command', () => this.openReviewTab(win)); menu.appendChild(item); }
    if (this.getPref('openOnStartup') && this.getPref('enabled')) win.setTimeout(() => this.openReviewTab(win), 800);
  },
  removeFromWindow(win) { if (!win) return; this.closeReviewTab(win); win.document.getElementById('review-tab-tools-menu')?.remove(); delete win.__reviewTabInstalled; },
  registerTabHooks(win) {
    if (win.__reviewTabHooks) return;
    win.__reviewTabHooks = true;
    const hooks = win.Zotero_Tabs?.tabHooks;
    if (!hooks) return;
    hooks.refocus.reviewtab = () => {
      const view = this.tabViews.get(win);
      /* 标签页重新获得焦点时重绘：增量同步可能在其失焦期间改了库 */
      if (view?.onTabFocus) { try { view.onTabFocus(); } catch (error) { this.report(error, 'refocus render'); } }
      win.document.querySelector('.rt3-app button, .rt3-app [role=button]')?.focus();
    };
    hooks.focusFirst.reviewtab = hooks.refocus.reviewtab;
  },
  openReviewTab(win) {
    try {
      if (!win || !this.getPref('enabled')) return;
      this.registerTabHooks(win);
      const tabID = 'review-tab-main';
      if (win.Zotero_Tabs?._getTab?.(tabID)?.tab) { win.Zotero_Tabs.select(tabID); return; }
      const created = win.Zotero_Tabs.add({ id: tabID, type: 'reviewtab', title: '回顾', data: {}, select: true, onClose: () => this.destroyTabView(win) });
      const script = win.document.createElement('script'); script.src = this.rootURI + 'content/review-tab.js';
      script.addEventListener('load', () => { try { const view = new win.ReviewTabView(this.forWindow(win, tabID), win, created.container); view.tabID = tabID; this.tabViews.set(win, view); } catch (error) { this.report(error, 'create tab view'); } });
      created.container.appendChild(script);
    } catch (error) { this.report(error, 'open tab'); }
  },
  closeReviewTab(win) { try { if (win.Zotero_Tabs?._getTab?.('review-tab-main')?.tab) win.Zotero_Tabs.close('review-tab-main', { skipHistory: true }); } catch (_) {} },
  destroyTabView(win) { this.tabViews.get(win)?.destroy(); this.tabViews.delete(win); },
  forWindow(win, tabID) {
    const plugin = this;
    const methods = ['prepareView', 'ensureInitialContent', 'getDashboard', 'getRecentUnits', 'getUnit', 'gradeUnit', 'undoTodayRating', 'recordPractice', 'setPriority', 'setUnitFlag', 'openAnnotation', 'openNote', 'newNote', 'annotationTypeLabel', 'getAnnotationContext',  'refreshAllContent', 'stateRevision', 'clearViewsStale'];
    const api = { win, tabID, rootURI: plugin.rootURI, imageAPI: plugin.imageAPI, openPreferences: () => plugin.openPreferences(win), getStylesheetText: () => plugin.getStylesheetText() };
    for (const method of methods) api[method] = plugin[method].bind(plugin);
    return api;
  },
  getStylesheetText() {
    try {
      const request = new XMLHttpRequest();
      request.open('GET', `${this.rootURI}content/review-tab.css`, false);
      request.send();
      if (request.status === 0 || request.status === 200) return request.responseText;
    } catch (error) { this.report(error, 'load stylesheet'); }
    return '';
  },
  openPreferences(win) { try { win.openDialog('chrome://zotero/content/preferences/preferences.xhtml', 'zotero-prefs', 'chrome,titlebar,toolbar,centerscreen,resizable', { pane: this.id }); } catch (_) { Services.prompt.alert(win, 'Review Tab', 'Open Zotero Settings → Review Tab.'); } },

  defaultState(libraryID) {
    const parameters = this.FSRS.generatorParameters({ enable_fuzz: true });
    return { format: 'review-tab-sync', version: 3, libraryID, updatedAt: new Date().toISOString(), initialContentCreatedAt: null, schedulerVersion: this.fsrsAPI.SCHEDULER_VERSION, fsrsParameters: parameters, units: {}, dailyQueue: null, dailyStats: {}, optimizerEligibleAt: null };
  },
  migrateState(state, libraryID) {
    const next = Object.assign(this.defaultState(libraryID), state || {});
    next.version = 3; next.units ||= {}; next.fsrsParameters ||= this.FSRS.generatorParameters({ enable_fuzz: true });
    delete next.index;
    for (const unit of Object.values(next.units)) { delete unit.activityKeys; delete unit.lastActivityDate; delete unit.enrolledAt; }
    return next;
  },
  async getStateNote(libraryID, create) {
    const cachedID = this.stateNoteIDs.get(libraryID);
    if (cachedID) { const cached = Zotero.Items.get(cachedID); if (cached) return cached; }
    const ids = await Zotero.DB.columnQueryAsync('SELECT N.itemID FROM itemNotes N JOIN items I USING(itemID) WHERE I.libraryID=? AND N.parentItemID IS NULL AND (N.note LIKE ? OR N.title=?) LIMIT 1', [libraryID, '%data-review-tab-state%', this.syncNoteTitle]);
    if (ids.length) { const note = await Zotero.Items.getAsync(ids[0]); this.stateNoteIDs.set(libraryID, note.id); return note; }
    if (!create) return null;
    const note = new Zotero.Item('note'); note.libraryID = libraryID;
    note.setNote(`<h1>${this.syncNoteTitle}</h1><p>This is Review Tab's compact sync state. Do not edit the state block manually.</p><pre data-review-tab-state="true">{}</pre>`);
    await note.saveTx(); this.stateNoteIDs.set(libraryID, note.id); return note;
  },
  async loadState(libraryID = Zotero.Libraries.userLibraryID, force = false) {
    if (!force && this.stateCache.has(libraryID)) return this.stateCache.get(libraryID);
    const note = await this.getStateNote(libraryID, false);
    let state = this.defaultState(libraryID);
    const noteContent = note ? note.getNote() : null;
    if (note) {
      const match = note.getNote().match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
      try {
        if (!match) throw new Error('missing state block');
        state = JSON.parse(this.decodeHTML(match[1]));
        if (!state || typeof state !== 'object' || Array.isArray(state) || (state.format && state.format !== 'review-tab-sync') || (state.version && state.version > 3) || (state.libraryID != null && state.libraryID !== libraryID) || (state.units != null && (typeof state.units !== 'object' || Array.isArray(state.units)))) throw new Error('invalid or unsupported state');
      } catch (error) {
        this.report(error, 'parse sync state');
        throw new Error('复习状态无法读取或版本不受支持。为保护数据，已停止写入；请备份 Review Tab — Sync State 笔记并检查或恢复它。');
      }
    }
    state = this.migrateState(state, libraryID);
    this.stateNoteBaseline.set(libraryID, noteContent); this.stateCache.set(libraryID, state); return state;
  },
  async reloadState(libraryID = Zotero.Libraries.userLibraryID) {
    const previous = this.stateOperationQueues.get(libraryID) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.loadState(libraryID, true));
    this.stateOperationQueues.set(libraryID, next);
    return next;
  },
  async saveState(libraryID, state) {
    const write = async () => {
      const started = Date.now();
      state.updatedAt = new Date().toISOString();
      let note = await this.getStateNote(libraryID, false);
      const baseline = this.stateNoteBaseline.get(libraryID);
      if ((note ? note.getNote() : null) !== baseline) throw new Error('复习状态已被外部更改；请备份并解决同步冲突后重试。');
      if (!note) note = await this.getStateNote(libraryID, true);
      note.setNote(`<h1>${this.syncNoteTitle}</h1><p>This is Review Tab's compact sync state. Do not edit the state block manually.</p><pre data-review-tab-state="true">${this.escapeHTML(JSON.stringify(state))}</pre>`);
      await note.saveTx(); this.stateNoteBaseline.set(libraryID, note.getNote()); this.stateCache.set(libraryID, state);
      this.performance(started, 'save', { units: Object.keys(state.units || {}).length });
      return state;
    };
    const previous = this.stateSaveQueues.get(libraryID) || Promise.resolve();
    const next = previous.catch(() => {}).then(write);
    this.stateSaveQueues.set(libraryID, next);
    return next;
  },
  async withStateOperation(libraryID, operation) {
    const previous = this.stateOperationQueues.get(libraryID) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (this.stopped) throw new Error('插件已停止。');
      const committed = await this.loadState(libraryID);
      const before = JSON.stringify(committed);
      const working = JSON.parse(before);
      const result = await operation(working);
      if (this.stopped) throw new Error('插件已停止。');
      if (JSON.stringify(working) !== before) await this.saveState(libraryID, working);
      return result;
    });
    this.stateOperationQueues.set(libraryID, next);
    return next;
  },
  escapeHTML(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); },
  decodeHTML(value) { return String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); },

  resolveParent(item) { let cursor = item; while (cursor && !cursor.isRegularItem?.()) cursor = cursor.parentItem; return cursor || null; },
  isReviewableParent(parent) { return !!parent?.isRegularItem?.() && this.discoveryAPI.isReviewableType(parent.itemType); },
  addInkRecord(records, parent, annotation) {
    const day = this.discoveryAPI.isBookType(parent.itemType) ? this.discoveryAPI.readingDayKey(annotation.dateAdded, this.getBoundary()) : '';
    const key = `${annotation.parentID}:${day}`;
    const existing = records.get(key);
    if (existing) {
      existing.activity.inkCount += 1;
      if (annotation.dateAdded < existing.activity.dateAdded) existing.activity.dateAdded = annotation.dateAdded;
    } else {
      records.set(key, { parent, activity: { isNote: false, isAnnotation: false, inkCount: 1, dateAdded: annotation.dateAdded, annotationPageLabel: null } });
    }
  },
  async collectInitialRecords(libraryID) {
    const all = await Zotero.Items.getAll(libraryID, false, false);
    const records = [];
    this.childParents.clear();
    /* 同一附件上的手写批注合成一条活动记录：一次手写往往有几十笔，不能逐笔计数 */
    const inkRecords = new Map();
    for (const activity of all) {
      if (!activity || (!activity.isNote?.() && !activity.isAnnotation?.())) continue;
      const parent = this.resolveParent(activity);
      if (!this.isReviewableParent(parent)) continue;
      /* 登记子条目归属，供删除事件回溯 */
      this.childParents.set(activity.id, parent.key);
      const isInk = !!activity.isInk?.();
      const isNote = !!activity.isNote?.();
      const isAnnotation = !!activity.isAnnotation?.() && !isInk;
      if (isInk) {
        this.addInkRecord(inkRecords, parent, activity);
        continue;
      }
      records.push({ parent, activity: { isNote, isAnnotation, inkCount: 0, dateAdded: activity.dateAdded, annotationPageLabel: activity.annotationPageLabel || null } });
    }
    records.push(...inkRecords.values());
    return records;
  },
  async ensureInitialContent() {
    const libraryID = Zotero.Libraries.userLibraryID;
    const existing = this.initializationPromises.get(libraryID);
    if (existing) return existing;
    const task = (async () => {
      const state = await this.loadState(libraryID);
      if (state.initialContentCreatedAt) return state;
      await this.withStateOperation(libraryID, working => this.rebuildAll(working, libraryID, { firstRun: true, save: false }));
      this.needsFullReconcile = false;
      return this.stateCache.get(libraryID);
    })();
    this.initializationPromises.set(libraryID, task);
    try { return await task; } finally { this.initializationPromises.delete(libraryID); }
  },
  /* 全量重建：重新扫描个人库，重建全部单元。评分、日志、暂停等用户状态经 applySummary 保留。
     仅供手动刷新与首次建档使用，避免频繁扫库 */
  async rebuildAll(state, libraryID = Zotero.Libraries.userLibraryID, { firstRun = false, save = true } = {}) {
    const started = Date.now();
    const records = await this.collectInitialRecords(libraryID);
    const groups = this.discoveryAPI.groupActivities(records, this.getBoundary());
    const now = new Date();
    const units = Object.assign({}, state.units);
    const present = new Set();
    for (const group of groups.values()) {
      present.add(group.descriptor.id);
      const summary = this.discoveryAPI.sourceSummary(group);
      const lane = firstRun
        ? (this.discoveryAPI.isRecent(summary.lastActivityAt, now, 30) ? 'new' : 'backlog')
        : (state.units[group.descriptor.id]?.lane || 'new');
      const prior = state.units[group.descriptor.id];
      units[group.descriptor.id] = this.discoveryAPI.applySummary(prior, group.descriptor, summary, lane);
      /* 「最近活动」排在首次建档时也要有值，否则全部视图按该字段排序会全是 NaN */
      if (!units[group.descriptor.id].recentUpdatedAt) units[group.descriptor.id].recentUpdatedAt = summary.lastActivityAt || now.toISOString();
    }
    state.units = units;
    this.unitsAPI.markUnavailable(state, null, present);
    if (!state.initialContentCreatedAt) state.initialContentCreatedAt = now.toISOString();
    state.unitsRebuiltAt = now.toISOString();
    /* 队列里指向已不存在单元的条目一并清掉 */
    this.unitsAPI.pruneQueue(state);
    if (save) await this.saveState(libraryID, state);
    this.debug('UNITS_REBUILT', { units: Object.keys(units).length, firstRun });
    this.performance(started, 'scan', { records: records.length, units: present.size });
    return state;
  },
  /* 标记视图数据已过期：不在后台重绘，等标签页重新获得焦点时再刷新 */
  markViewsStale() {
    this.viewsStale = true;
    this.revision = (this.revision || 0) + 1;
  },
  /* 状态版本号：视图切回标签页时用它判断数据是否变过 */
  stateRevision() { return this.revision || 0; },
  clearViewsStale() { this.viewsStale = false; },
  /* 视图刷新：让打开的回顾标签页重绘（只在切回标签页或用户手动刷新时调用） */
  refreshViews() {
    this.viewsStale = false;
    for (const win of Zotero.getMainWindows()) this.tabViews.get(win)?.refresh(false).catch(error => this.report(error, 'refresh views'));
  },
  /* 手动刷新：全量重建后立即让所有打开的回顾标签页重绘 */
  async refreshAllContent() {
    const libraryID = Zotero.Libraries.userLibraryID;
    await this.reloadState(libraryID);
    await this.ensureInitialContent();
    await this.withStateOperation(libraryID, state => this.rebuildAll(state, libraryID, { save: false }));
    this.refreshViews();
    return this.stateCache.get(libraryID).unitsRebuiltAt;
  },
  async rebuildParent(state, parent) {
    if (!this.isReviewableParent(parent)) return;
    const started = Date.now();
    const records = [];
    const noteIDs = parent.getNotes(false);
    const notes = await Zotero.Items.getAsync(noteIDs);
    for (const note of notes) records.push({ parent, activity: { isNote: true, isAnnotation: false, inkCount: 0, dateAdded: note.dateAdded, annotationPageLabel: null } });
    const attachmentIDs = parent.getAttachments(false);
    const attachments = await Zotero.Items.getAsync(attachmentIDs);
    for (const attachment of attachments.filter(item => item.isFileAttachment?.())) {
      const annotations = await Zotero.Items.getAsync(attachment.getAnnotations(false, true));
      const inkRecords = new Map();
      for (const annotation of annotations) {
        if (annotation.isInk?.()) {
          this.addInkRecord(inkRecords, parent, annotation);
          continue;
        }
        records.push({ parent, activity: { isNote: false, isAnnotation: true, inkCount: 0, dateAdded: annotation.dateAdded, annotationPageLabel: annotation.annotationPageLabel || null } });
      }
      records.push(...inkRecords.values());
    }
    this.applyParentRecompute(state, parent, records, { prune: true });
    this.performance(started, 'parent', { records: records.length });
  },
  /* 用重建结果覆盖该父条目下的全部单元；源内容已空的单元直接移除（连同其溯源信息） */
  applyParentRecompute(state, parent, records, { prune = false } = {}) {
    const groups = this.discoveryAPI.groupActivities(records, this.getBoundary());
    const now = new Date();
    const rebuilt = new Set();
    for (const group of groups.values()) {
      const summary = this.discoveryAPI.sourceSummary(group);
      const prior = state.units[group.descriptor.id];
      state.units[group.descriptor.id] = this.discoveryAPI.applySummary(prior, group.descriptor, summary, prior ? prior.lane : 'new');
      if (prior) state.units[group.descriptor.id].recentUpdatedAt = now.toISOString();
      if (prior) state.units[group.descriptor.id].lastKnownItemType = parent.itemType || null;
      rebuilt.add(group.descriptor.id);
    }
    if (!prune) return rebuilt;
    /* 该父条目下未出现在重建结果里的单元 = 笔记与注释都已清空，移除 */
    this.unitsAPI.markUnavailable(state, parent.key, rebuilt);
    return rebuilt;
  },
  /* 从今日队列快照里移除已不存在的单元，避免下次启动指向空洞 */
  purgeUnitFromQueue(state, unitId) {
    this.unitsAPI.purgeUnitFromQueue(state, unitId);
  },
  /* 删除事件里条目已经取不到，只能按删除前登记的归属回溯父条目 */
  async resolveDeletedParents(ids, state) {
    const libraryID = Zotero.Libraries.userLibraryID;
    const parents = new Map();
    const removed = [];
    const seen = new Set();
    for (const id of ids) {
      const ownerKey = this.childParents.get(id);
      if (!ownerKey || seen.has(ownerKey)) continue;
      seen.add(ownerKey);
      const parent = await this.findParent(libraryID, ownerKey);
      if (parent) parents.set(ownerKey, parent); else removed.push(ownerKey);
    }
    return { parents, removed };
  },
  notifierChanges(extraData, id) {
    const data = extraData?.[id] || {};
    return data.changed || data.changes || null;
  },
  isPresentationOnlyParentChange(event, changes) {
    if (event !== 'modify' || !changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
    const fields = Object.keys(changes);
    const safe = new Set(['title', 'firstCreator', 'creators', 'date', 'abstractNote', 'url', 'DOI', 'extra']);
    return fields.length > 0 && fields.every(field => safe.has(field));
  },
  async notify(event, type, ids, extraData) {
    if (this.stopped) return;
    if (type === 'tab' && event === 'close') {
      for (const id of ids) { const returnTab = this.readerReturnTabs.get(id); if (returnTab) { this.readerReturnTabs.delete(id); const win = Zotero.getMainWindow(); if (win?.Zotero_Tabs?._getTab?.(returnTab)?.tab) win.Zotero_Tabs.select(returnTab); } }
      return;
    }
    if (type !== 'item') return;
    const libraryID = Zotero.Libraries.userLibraryID;
    if (event === 'delete') {
      if (ids.some(id => !this.childParents.has(id))) this.needsFullReconcile = true;
      /* 被删条目已不可读，只能靠删除前登记的归属回调 */
      for (const id of ids) this.pendingDeletedIDs.add(id);
      this.markViewsStale();
      this.scheduleIntake();
      return;
    }
    if (!['add', 'modify'].includes(event)) {
      this.needsFullReconcile = true; this.markViewsStale();
      return;
    }
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item || item.libraryID !== libraryID || item.id === this.stateNoteIDs.get(libraryID)) continue;
      /* 手写批注也是注释子条目：拖动时连续出 modify 事件，会走 800ms 合并 */
      if (item.isNote?.() || item.isAnnotation?.() || item.isInk?.()) {
        this.pendingNotifierIDs.add(id);
        const parent = this.resolveParent(item);
        if (parent?.key) this.childParents.set(id, parent.key);
      } else if (item.isRegularItem?.()) {
        const changes = this.notifierChanges(extraData, id);
        /* 元数据与具体变更不确定时，保守保留重建；可确定的纯显示字段只刷新视图。 */
        if (!this.isPresentationOnlyParentChange(event, changes)) this.pendingParentKeys.add(item.key);
      } else if (item.isAttachment?.()) {
        this.needsFullReconcile = true;
      }
    }
    this.markViewsStale();
    if (!this.pendingNotifierIDs.size && !this.pendingParentKeys.size && !this.pendingDeletedIDs.size) return;
    if (this.hasActiveReviewView()) this.scheduleIntake();
  },
  hasActiveReviewView() {
    try {
      return Zotero.getMainWindows().some(win => {
        const tabs = win.Zotero_Tabs;
        return tabs?.selectedID === 'review-tab-main';
      });
    } catch (_) { return false; }
  },
  scheduleIntake() {
    if (!this.hasActiveReviewView()) return;
    clearTimeout(this.notifierTimer);
    this.notifierTimer = setTimeout(() => this.processNotifierItems().catch(error => this.report(error, 'notifier intake')), 800);
  },
  async processNotifierItems() {
    if (this.notifierIntakeRunning) return;
    const task = this.runNotifierItems();
    this.notifierIntakePromise = task;
    try { return await task; } finally { if (this.notifierIntakePromise === task) this.notifierIntakePromise = null; }
  },
  async runNotifierItems() {
    this.notifierIntakeRunning = true;
    let ids = [], deletedIds = [], parentKeys = [];
    let failed = false;
    try {
      const libraryID = Zotero.Libraries.userLibraryID;
      const committed = await this.loadState(libraryID);
      if (!committed.initialContentCreatedAt) {
        this.pendingNotifierIDs.clear(); this.pendingDeletedIDs.clear(); this.pendingParentKeys.clear();
        return;
      }
      ids = [...this.pendingNotifierIDs]; this.pendingNotifierIDs.clear();
      deletedIds = [...this.pendingDeletedIDs]; this.pendingDeletedIDs.clear();
      parentKeys = [...this.pendingParentKeys]; this.pendingParentKeys.clear();
      await this.withStateOperation(libraryID, async state => {
      const parents = new Map();
      let changed = false;

      for (const item of await Zotero.Items.getAsync(ids)) {
        const parent = this.resolveParent(item);
        if (this.isReviewableParent(parent)) { parents.set(parent.key, parent); this.childParents.set(item.id, parent.key); }
      }
      for (const key of parentKeys) {
        const parent = await this.findParent(libraryID, key);
        if (this.isReviewableParent(parent)) parents.set(parent.key, parent);
        /* 父条目已不存在或类型变得不可回顾：清掉它的全部单元 */
        else if (this.forgetParent(state, key)) changed = true;
      }

      if (deletedIds.length) {
        const { parents: deletedParents, removed } = await this.resolveDeletedParents(deletedIds, state);
        for (const [key, parent] of deletedParents) if (parent) parents.set(key, parent);
        for (const key of removed) if (this.forgetParent(state, key)) changed = true;
      }

      for (const parent of parents.values()) { await this.rebuildParent(state, parent); changed = true; }
      /* 评分或暂停状态可能指向已移除的单元，统一清理 */
      if (this.unitsAPI.pruneQueue(state) > 0) changed = true;
      if (changed) this.markViewsStale();
      });
      for (const id of deletedIds) this.childParents.delete(id);
    } catch (error) {
      failed = true;
      for (const id of ids) this.pendingNotifierIDs.add(id);
      for (const id of deletedIds) this.pendingDeletedIDs.add(id);
      for (const key of parentKeys) this.pendingParentKeys.add(key);
      throw error;
    } finally {
      this.notifierIntakeRunning = false;
      if (!failed && !this.stopped && (this.pendingNotifierIDs.size || this.pendingDeletedIDs.size || this.pendingParentKeys.size) && this.hasActiveReviewView()) this.scheduleIntake();
    }
  },
  async prepareView() {
    const libraryID = Zotero.Libraries.userLibraryID;
    await this.ensureInitialContent();
    if (this.needsFullReconcile) {
      this.needsFullReconcile = false;
      try {
        await this.withStateOperation(libraryID, state => this.rebuildAll(state, libraryID, { save: false }));
      } catch (error) {
        this.needsFullReconcile = true;
        throw error;
      }
    }
    while (this.pendingNotifierIDs.size || this.pendingDeletedIDs.size || this.pendingParentKeys.size) {
      if (this.notifierIntakeRunning) await this.notifierIntakePromise;
      else await this.processNotifierItems();
    }
  },
  /* 父条目被删除或已不可回顾：移除其全部单元与队列引用 */
  forgetParent(state, parentKey) {
    return this.unitsAPI.markUnavailable(state, parentKey);
  },

  fsrsAdapter(state) { return this.fsrsAPI.createAdapter(this.FSRS, state.fsrsParameters, this.getBoundary()); },
  async ensureDailyQueue(state, now = new Date(), save = true) {
    const boundary = this.getBoundary();
    const queue = state.dailyQueue;
    const storedBoundary = Number(queue?.boundaryHour);
    const queueBoundary = Number.isInteger(storedBoundary) && storedBoundary >= 0 && storedBoundary <= 23 ? storedBoundary : boundary;
    const dayKey = this.queueAPI.localDayKey(now, queueBoundary);
    if (queue?.dayKey === dayKey) {
      let changed = false;
      if (queue.boundaryHour !== queueBoundary) { queue.boundaryHour = queueBoundary; changed = true; }
      queue.items = queue.items.map(item => {
        if (Object.hasOwn(item, 'reviewedAt')) return item;
        changed = true;
        return Object.assign({ reviewedAt: null, rating: null, reviewLogRef: null, voidedAt: null }, item);
      });
      if (changed && save) await this.saveState(Zotero.Libraries.userLibraryID, state);
      return queue;
    }
    const limits = { total: this.getQueueLimit('dailyCount', 1, 100), newMax: this.getQueueLimit('newCardLimit', 0, 30), backlogThreshold: this.getQueueLimit('backlogThreshold', 0, 100), backlogMax: this.getQueueLimit('backlogDailyLimit', 0, 30) };
    state.dailyQueue = this.queueAPI.buildQueue(Object.values(state.units), now, boundary, limits);
    state.dailyQueue.items = state.dailyQueue.items.map(item => Object.assign({ reviewedAt: null, rating: null, reviewLogRef: null, voidedAt: null }, item));
    state.dailyStats[dayKey] ||= { fsrsCompleted: 0, good: 0, again: 0, newAdmitted: state.dailyQueue.stats.new, backlogReleased: state.dailyQueue.stats.backlog, practice: 0 };
    if (save) await this.saveState(Zotero.Libraries.userLibraryID, state);
    return state.dailyQueue;
  },
  async getDashboard() {
    await this.ensureInitialContent();
    await this.withStateOperation(Zotero.Libraries.userLibraryID, state => this.ensureDailyQueue(state, new Date(), false));
    const state = this.stateCache.get(Zotero.Libraries.userLibraryID);
    const queue = state.dailyQueue;
    const units = queue.items.filter(item => state.units[item.unitId] && !state.units[item.unitId].sourceUnavailable && !state.units[item.unitId].paused && !state.units[item.unitId].stopped).map(item => Object.assign({}, state.units[item.unitId], { queueSource: item.source, reviewedToday: !!item.reviewedAt && !item.voidedAt, queueRating: item.rating || null })).filter(Boolean);
    const stats = state.dailyStats[queue.dayKey];
    const items = await Promise.all(units.filter(unit => unit.id).map(unit => this.hydrateUnit(unit, { detail: false })));
    return { initialized: true, queue, stats, units: items.filter(unit => !unit.excluded), optimizerEligible: !!state.optimizerEligibleAt };
  },
  async getRecentUnits({ offset = 0, limit = 40, sort = 'added' } = {}) {
    const state = await this.ensureInitialContent();
    const field = sort === 'modified' ? 'recentUpdatedAt' : 'lastActivityAt';
    const units = Object.values(state.units).filter(unit => !unit.sourceUnavailable).sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0));
    const page = units.slice(offset, offset + limit);
    const items = await Promise.all(page.map(unit => this.hydrateUnit(unit, { detail: false })));
    return { items: items.filter(unit => !unit.excluded), nextOffset: offset + page.length, hasMore: offset + page.length < units.length };
  },
  async getUnit(id, options) { const state = await this.ensureInitialContent(); const unit = state.units[id]; return unit ? this.hydrateUnit(unit, Object.assign({ detail: true }, options)) : null; },
  async findParent(libraryID, key) { const ids = await Zotero.DB.columnQueryAsync('SELECT itemID FROM items WHERE libraryID=? AND key=? LIMIT 1', [libraryID, key]); return ids.length ? Zotero.Items.getAsync(ids[0]) : null; },
  async hydrateUnit(unit, { detail = false, annotationOffset = 0, annotationLimit = 200 } = {}) {
    const parent = await this.findParent(Zotero.Libraries.userLibraryID, unit.parentKey);
    if (!parent) return Object.assign({}, unit, { title: '已删除的 Zotero 条目', missing: true, notes: [], annotations: [] });
    /* 非论文 / 书籍类条目（软件、数据集等）不进入回顾视图 */
    if (!this.discoveryAPI.isReviewableType(parent.itemType)) return Object.assign({}, unit, { title: parent.getDisplayTitle(), excluded: true, notes: [], annotations: [], annotationTotal: 0 });
    const result = Object.assign({}, unit, { parentRef: `${parent.libraryID}:${parent.key}`, itemType: parent.itemType, title: parent.getDisplayTitle(), creator: parent.getField('firstCreator'), year: parent.getField('year'), notes: [], annotations: [] });
    if (!detail) return result;
    const notes = await Zotero.Items.getAsync(parent.getNotes(false));
    const bounds = unit.sessionDay ? this.discoveryAPI.localDayBounds(unit.sessionDay, this.getBoundary()) : null;
    result.notes = notes.filter(note => !bounds || (new Date(note.dateAdded) >= new Date(bounds.start) && new Date(note.dateAdded) < new Date(bounds.end))).map(note => ({ key: note.key, title: note.getNoteTitle() || '', html: note.getNote(), dateAdded: note.dateAdded }));
    const attachmentIDs = parent.getAttachments(false);
    const clause = attachmentIDs.length ? `AND IA.parentItemID IN (${attachmentIDs.map(() => '?').join(',')})` : 'AND 1=0';
    const timeClause = bounds ? 'AND I.dateAdded>=? AND I.dateAdded<?' : '';
    const params = attachmentIDs.slice(); if (bounds) params.push(this.toSQLDate(bounds.start), this.toSQLDate(bounds.end));
    const total = await Zotero.DB.valueQueryAsync(`SELECT COUNT(*) FROM itemAnnotations IA JOIN items I USING(itemID) WHERE 1=1 ${clause} ${timeClause}`, params);
    /* sortIndex 形如 "00001|000100|00309"（页 | y | x），按字符串排序即按页、再按页内位置 */
    const ids = await Zotero.DB.columnQueryAsync(`SELECT IA.itemID FROM itemAnnotations IA JOIN items I USING(itemID) WHERE 1=1 ${clause} ${timeClause} ORDER BY IA.pageLabel + 0, IA.sortIndex, IA.itemID LIMIT ? OFFSET ?`, params.concat([annotationLimit, annotationOffset]));
    const annotations = await Zotero.Items.getAsync(ids);
    result.annotationTotal = total;
    result.annotations = annotations.map(item => this.annotationSummary(item));
    result.hasMoreAnnotations = annotationOffset + result.annotations.length < total;
    return result;
  },
  /* 注释摘要：图片注释不把截图本体（base64，每条几十 KB 到 1 MB）塞进视图，
     只给缓存文件的 file: 链接与区域矩形，由 <img> 按需解码（见 annotationImageInfo） */
  annotationSummary(item) {
    const isInk = !!item.isInk?.();
    const summary = {
      key: item.key,
      type: item.annotationType,
      text: item.annotationText,
      comment: item.annotationComment,
      color: item.annotationColor,
      pageLabel: item.annotationPageLabel || '',
      authorName: item.annotationAuthorName || '',
      hasImage: item.annotationIsImage?.() || isInk,
      inkCount: isInk ? (item.annotationInk?.length || 0) : 0
    };
    /* 页码用于分组显示；不再生成截图或区域遮罩，视图只看文字 */
    summary.pageIndex = Math.max(0, Number(this.imageAPI.parsePosition(item.annotationPosition).pageIndex) || 0);
    return summary;
  },

  /* 注释在原文中的上下文：用 Zotero 的全文索引（父附件的 PDF 文字层）定位高亮片段。
     图片注释没有文字，就取它后面的文字作为上下文；定位不到就返回 null，
     由视图退回到「只看截图」。结果按附件缓存，附件重建索引（version 变化）后自然失效 */
  fullTextCache: new Map(),
  async getAnnotationContext(key) {
    const ids = await Zotero.DB.columnQueryAsync('SELECT itemID FROM items WHERE key=? LIMIT 1', [key]);
    if (!ids.length) return null;
    const item = await Zotero.Items.getAsync(ids[0]);
    if (!item?.isAnnotation?.()) return null;
    const snippet = this.imageAPI.snippetCandidate({ highlightText: item.annotationText }) || this.imageAPI.snippetCandidate({ text: item.annotationComment });
    if (!snippet) return null;
    const attachment = item.parentID ? Zotero.Items.get(item.parentID) : null;
    if (!attachment || !attachment.isPDFAttachment?.()) return null;
    const text = await this.getAttachmentFullText(attachment);
    if (!text) return null;
    const found = this.imageAPI.findSnippet(text, snippet);
    if (!found) return null;
    return { mark: text.slice(found.start, found.end), before: found.before, after: found.after, html: this.imageAPI.previewHTML({ before: found.before, mark: text.slice(found.start, found.end), after: found.after }) };
  },
  /* 取附件全文。Zotero 7 把全文放在独立的 fulltext.sqlite，且是 contentless FTS5（原文存在数据块的
     BLOB 里，不能直接 SELECT text），所以这里优先用 API；只有 API 失效时才退回旧版 words 表。
     数据量大（一本 PDF 几十万字），按附件 + 版本号缓存，最多留 8 份 */
  async getAttachmentFullText(attachment) {
    const cached = this.fullTextCache.get(attachment.id);
    if (cached && cached.version === (attachment.version || 0)) return cached.text;
    let text = null;
    try {
      text = await Zotero.Fulltext.getItemContent(attachment.id, { includeContent: true });
    } catch (error) { this.report(error, 'fulltext api'); }
    if (!text) {
      try {
        const rows = await Zotero.DB.queryAsync('SELECT text FROM fulltextWords WHERE itemID=? ORDER BY wordsIndex, index', [attachment.id]);
        if (rows.length) text = rows.map(row => String(row.text || '')).join('\n');
      } catch (_) { /* 新版没有 words 表 */ }
    }
    if (typeof text !== 'string' || !text) text = null;
    if (this.fullTextCache.size >= 8) this.fullTextCache.delete(this.fullTextCache.keys().next().value);
    this.fullTextCache.set(attachment.id, { version: attachment.version || 0, text });
    return text;
  },
  toSQLDate(value) { const date = new Date(value); const p = n => String(n).padStart(2, '0'); return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`; },

  async gradeUnit(id, rating) {
    await this.prepareView();
    return this.withStateOperation(Zotero.Libraries.userLibraryID, async state => {
    const unit = state.units[id]; if (!unit) return;
    if (unit.sourceUnavailable) throw new Error('来源不可用，无法评分。');
    const now = new Date(); const boundary = this.getBoundary();
    const queue = await this.ensureDailyQueue(state, now, false); const dayKey = queue.dayKey;
    const queueItem = queue.items.find(item => item.unitId === id); if (!queueItem) throw new Error('Unit is not in today\'s formal queue');
    if (queueItem.reviewedAt && !queueItem.voidedAt) throw new Error('请先撤销今天的评分，再重新评分。');
    const priorCard = unit.fsrsCard ? JSON.parse(JSON.stringify(unit.fsrsCard)) : null;
    const priorLane = unit.lane;
    const adapter = this.fsrsAdapter(state); const result = adapter.createRatedCard(unit.fsrsCard, unit.id, now, rating);
    const logId = `${id}:${now.getTime()}:${unit.reviewLogs.length}`;
    const event = Object.assign({ id: logId, beforeCard: priorCard, beforeLane: priorLane, voidedAt: null, voidReason: null }, result.log);
    unit.fsrsCard = result.card; unit.reviewLogs.push(event); unit.lane = 'scheduled'; unit.lastReviewedAt = now.toISOString(); unit.dueAt = result.card.effectiveDueAt;
    queueItem.reviewedAt = now.toISOString(); queueItem.rating = rating; queueItem.reviewLogRef = logId; queueItem.voidedAt = null;
    if (unit.reviewLogs.filter(log => !log.voidedAt).length >= 200 && !state.optimizerEligibleAt) state.optimizerEligibleAt = now.toISOString();
    const stats = state.dailyStats[dayKey] ||= { fsrsCompleted: 0, good: 0, again: 0, newAdmitted: 0, backlogReleased: 0, practice: 0 };
    stats.fsrsCompleted += 1; if (rating === this.FSRS.Rating.Again) stats.again += 1; if (rating === this.FSRS.Rating.Good) stats.good += 1;
    return result;
    });
  },
  async undoTodayRating(id) {
    await this.prepareView();
    return this.withStateOperation(Zotero.Libraries.userLibraryID, async state => {
    const now = new Date(); const boundary = this.getBoundary();
    const queue = await this.ensureDailyQueue(state, now, false); const dayKey = queue.dayKey; const queueItem = queue.items.find(item => item.unitId === id);
    const unit = state.units[id]; if (!unit || !queueItem?.reviewLogRef || !queueItem.reviewedAt || queue.dayKey !== dayKey) throw new Error('No undoable rating for this unit today');
    const log = unit.reviewLogs.find(item => item.id === queueItem.reviewLogRef); if (!log || log.voidedAt) throw new Error('The rating is no longer undoable');
    const laterActive = unit.reviewLogs.some(item => !item.voidedAt && item.id !== log.id && new Date(item.review) > new Date(log.review));
    if (laterActive) throw new Error('A later rating exists for this unit');
    unit.fsrsCard = log.beforeCard || null; unit.lane = log.beforeCard ? 'scheduled' : log.beforeLane;
    unit.lastReviewedAt = log.beforeCard?.last_review || null; unit.dueAt = log.beforeCard?.effectiveDueAt || null;
    log.voidedAt = now.toISOString(); log.voidReason = 'user-undo'; queueItem.voidedAt = now.toISOString(); queueItem.reviewedAt = null; queueItem.rating = null;
    const stats = state.dailyStats[dayKey]; stats.fsrsCompleted = Math.max(0, stats.fsrsCompleted - 1); if (log.rating === this.FSRS.Rating.Again) stats.again = Math.max(0, stats.again - 1); if (log.rating === this.FSRS.Rating.Good) stats.good = Math.max(0, stats.good - 1);
    });
  },
  async setUnitFlag(id, flags) {
    await this.prepareView();
    return this.withStateOperation(Zotero.Libraries.userLibraryID, async state => {
    const unit = state.units[id]; if (!unit) return;
    for (const key of ['paused', 'stopped', 'priority']) if (Object.hasOwn(flags, key)) unit[key] = flags[key];
    });
  },
  async recordPractice(id, note = '') {
    await this.prepareView();
    return this.withStateOperation(Zotero.Libraries.userLibraryID, async state => {
    const unit = state.units[id]; if (!unit) return;
    const now = new Date(); const queue = await this.ensureDailyQueue(state, now, false); unit.practiceLogs.push({ viewedAt: now.toISOString(), note });
    const dayKey = queue.dayKey; const stats = state.dailyStats[dayKey] ||= { fsrsCompleted: 0, good: 0, again: 0, newAdmitted: 0, backlogReleased: 0, practice: 0 }; stats.practice += 1;
    });
  },
  async setPriority(id, priority) { return this.setUnitFlag(id, { priority }); },
  annotationTypeLabel(type) { return ({ highlight: '高亮', underline: '下划线', note: '文字便签', image: '图片 / 框选区域', ink: '手写批注' })[type] || type || '注释'; },
  async openAnnotation(key, sourceTabID) { const ids = await Zotero.DB.columnQueryAsync('SELECT itemID FROM items WHERE key=? LIMIT 1', [key]); if (!ids.length) return; const item = await Zotero.Items.getAsync(ids[0]); if (!item?.parentItem) return; await Zotero.Reader.open(item.parentItem.id, { annotationID: item.key }); const reader = Zotero.Reader._readers?.find(candidate => candidate.itemID === item.parentItem.id && candidate.tabID); if (reader?.tabID) this.readerReturnTabs.set(reader.tabID, sourceTabID); },
  async openNote(key) { const ids = await Zotero.DB.columnQueryAsync('SELECT itemID FROM items WHERE key=? LIMIT 1', [key]); if (ids.length) Zotero.Notes.open(ids[0]); },
  async newNote(parentRef) { const [libraryID, key] = parentRef.split(':'); const parent = await this.findParent(Number(libraryID), key); if (!parent) return; const note = new Zotero.Item('note'); note.libraryID = parent.libraryID; note.parentKey = parent.key; await note.saveTx(); await Zotero.Notes.open(note.id); }
};
function install(data, reason) { return ReviewTabPlugin.install(data, reason); }
function startup(data, reason) { return ReviewTabPlugin.startup(data, reason); }
function shutdown(data, reason) { return ReviewTabPlugin.shutdown(data, reason); }
function uninstall(data, reason) { return ReviewTabPlugin.uninstall(data, reason); }
function onMainWindowLoad(data) { return ReviewTabPlugin.onMainWindowLoad(data); }
function onMainWindowUnload(data) { return ReviewTabPlugin.onMainWindowUnload(data); }















