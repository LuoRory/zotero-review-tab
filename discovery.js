(function (root) {
  const BOOK_TYPES = new Set(['book', 'bookSection', 'encyclopediaArticle', 'manual', 'dictionaryEntry']);
  /* 论文类条目：期刊、会议、报告、学位论文等。软件、数据集、网页等不在回顾范围内 */
  const PAPER_TYPES = new Set(['journalArticle', 'conferencePaper', 'preprint', 'report', 'thesis', 'patent', 'standard', 'document', 'letter']);

  function isBookType(itemType) {
    return BOOK_TYPES.has(itemType);
  }

  function isPaperType(itemType) {
    return PAPER_TYPES.has(itemType);
  }

  /* 只有论文类与书籍类条目进入回顾流程 */
  function isReviewableType(itemType) {
    return BOOK_TYPES.has(itemType) || PAPER_TYPES.has(itemType);
  }

  function readingDayKey(dateValue, boundaryHour) {
    const date = new Date(dateValue);
    date.setHours(date.getHours() - boundaryHour);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function localDayBounds(dayKey, boundaryHour) {
    const [year, month, day] = dayKey.split('-').map(Number);
    const start = new Date(year, month - 1, day, boundaryHour, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  function unitDescriptor(parent, activity, boundaryHour) {
    const book = isBookType(parent.itemType);
    const readingDay = book ? readingDayKey(activity.dateAdded, boundaryHour) : null;
    return {
      id: book ? `book-session:${parent.key}:${readingDay}` : `article:${parent.key}`,
      parentKey: parent.key,
      unitType: book ? 'book-session' : 'article',
      sessionDay: readingDay
    };
  }

  function groupActivities(records, boundaryHour) {
    const groups = new Map();
    for (const { parent, activity } of records) {
      if (!isReviewableType(parent.itemType)) continue;
      const descriptor = unitDescriptor(parent, activity, boundaryHour);
      if (!groups.has(descriptor.id)) groups.set(descriptor.id, { descriptor, activities: [] });
      groups.get(descriptor.id).activities.push(activity);
    }
    return groups;
  }

  /* 注释计数：普通注释 + 手写批注。手写批注在 Zotero 里也存成注释，但旧批次只登记了普通注释 */
  function annotationTotal(activity) {
    return (activity.annotationCount || 0) + (activity.inkCount || 0);
  }

  function sourceSummary(group) {
    const activities = group.activities;
    const dates = activities.map(item => new Date(item.dateAdded).toISOString()).sort();
    const numericPages = activities.filter(item => item.annotationPageLabel != null && String(item.annotationPageLabel).trim() !== '').map(item => Number(item.annotationPageLabel)).filter(Number.isFinite).sort((a, b) => a - b);
    return {
      annotationCount: activities.reduce((total, item) => total + (item.isAnnotation ? 1 : 0) + (item.inkCount || 0), 0),
      noteCount: activities.filter(item => item.isNote).length,
      activityCount: activities.length,
      firstActivityAt: dates[0] || null,
      lastActivityAt: dates.at(-1) || null,
      pageRange: numericPages.length ? { first: numericPages[0], last: numericPages.at(-1) } : null
    };
  }

  function applySummary(existing, descriptor, summary, lane) {
    const userState = existing ? {
      fsrsCard: existing.fsrsCard || null,
      reviewLogs: existing.reviewLogs || [],
      practiceLogs: existing.practiceLogs || [],
      lane: existing.lane,
      priority: existing.priority || 'normal',
      paused: !!existing.paused,
      stopped: !!existing.stopped,
      lastReviewedAt: existing.lastReviewedAt || null,
      dueAt: existing.dueAt || null
    } : {
      fsrsCard: null, reviewLogs: [], practiceLogs: [], lane, priority: 'normal', paused: false, stopped: false, lastReviewedAt: null, dueAt: null
    };
    const result = Object.assign({}, existing || {}, descriptor, summary, userState, { sourceUnavailable: false, lane: userState.fsrsCard ? 'scheduled' : userState.lane || lane });
    delete result.activityKeys;
    return result;
  }

  function isRecent(activityAt, now, days = 30) {
    return new Date(activityAt).getTime() >= now.getTime() - days * 86400000;
  }

  const api = { BOOK_TYPES, PAPER_TYPES, isBookType, isPaperType, isReviewableType, readingDayKey, localDayBounds, unitDescriptor, groupActivities, annotationTotal, sourceSummary, applySummary, isRecent };
  if (typeof module !== 'undefined') module.exports = api;
  root.ReviewTabDiscovery = api;
}(this));
