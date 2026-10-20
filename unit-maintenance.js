(function (root) {
  /* 单元维护的纯逻辑：删除单元、清理队列引用、判断父条目是否已无内容。
     与 Zotero API 无关，便于在 Node 中直接测试。 */

  /* 从今日队列快照里移除指定单元，返回是否发生变化 */
  function purgeUnitFromQueue(state, unitId) {
    if (!state?.dailyQueue?.items) return false;
    const before = state.dailyQueue.items.length;
    state.dailyQueue.items = state.dailyQueue.items.filter(item => item.unitId !== unitId);
    return state.dailyQueue.items.length !== before;
  }

  /* 移除某父条目下的全部单元（父条目被删、或类型变得不可回顾时使用） */
  function forgetParent(state, parentKey) {
    if (!state?.units || !parentKey) return false;
    let changed = false;
    for (const [id, unit] of Object.entries(state.units)) {
      if (unit.parentKey !== parentKey) continue;
      delete state.units[id];
      purgeUnitFromQueue(state, id);
      changed = true;
    }
    return changed;
  }

  /* 队列引用的单元已经不存在时清掉，返回清理数量 */
  function pruneQueue(state) {
    if (!state?.dailyQueue?.items) return 0;
    const before = state.dailyQueue.items.length;
    state.dailyQueue.items = state.dailyQueue.items.filter(item => !!state.units?.[item.unitId]);
    return before - state.dailyQueue.items.length;
  }

  /* 重建结果里没有的单元 = 笔记与注释都已清空，需要删除 */
  function pruneRebuiltParent(state, parentKey, rebuiltIds) {
    const rebuilt = rebuiltIds instanceof Set ? rebuiltIds : new Set(rebuiltIds);
    const removed = [];
    for (const [id, unit] of Object.entries(state.units || {})) {
      if (unit.parentKey !== parentKey || rebuilt.has(id)) continue;
      delete state.units[id];
      purgeUnitFromQueue(state, id);
      removed.push(id);
    }
    return removed;
  }

  /* 来源消失时保留卡片和历史，来源恢复后可重新启用。 */
  function markUnavailable(state, parentKey, presentIds = new Set()) {
    let changed = false;
    for (const [id, unit] of Object.entries(state.units || {})) {
      if (parentKey && unit.parentKey !== parentKey) continue;
      const unavailable = !presentIds.has(id);
      if (!!unit.sourceUnavailable !== unavailable) {
        unit.sourceUnavailable = unavailable;
        changed = true;
      }
    }
    return changed;
  }

  const api = { purgeUnitFromQueue, forgetParent, pruneQueue, pruneRebuiltParent, markUnavailable };
  if (typeof module !== 'undefined') module.exports = api;
  root.ReviewTabUnits = api;
}(this));
