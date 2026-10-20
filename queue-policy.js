(function (root) {
  const DEFAULT_LIMITS = { total: 20, newMax: 6, newMin: 1 };
  const PRIORITY = { low: 0, normal: 1, high: 2, core: 3 };

  function localDayKey(now, boundaryHour) {
    const date = new Date(now);
    date.setHours(date.getHours() - boundaryHour);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function startOfLocalDay(dayKey, boundaryHour) {
    const [year, month, day] = dayKey.split('-').map(Number);
    return new Date(year, month - 1, day, boundaryHour, 0, 0, 0);
  }

  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function scoreCandidate(unit, now) {
    const freshnessDays = Math.max(0, (now.getTime() - new Date(unit.lastActivityAt || now).getTime()) / 86400000);
    const freshness = 1 / (1 + freshnessDays / 30);
    const density = Math.min(2, Math.log1p(Number(unit.annotationCount || 0) + Number(unit.noteCount || 0)) / 2);
    const priority = PRIORITY[unit.priority || 'normal'] || 0;
    return priority * 4 + freshness * 2 + density + (hash(unit.id) % 1000) / 1000000;
  }

  function takeDiverse(candidates, count, selectedParents, now, preserveOrder = false) {
    const sorted = preserveOrder ? candidates : candidates.slice().sort((a, b) => scoreCandidate(b, now) - scoreCandidate(a, now));
    const chosen = [];
    for (const unit of sorted) {
      if (chosen.length >= count) break;
      if (selectedParents.has(unit.parentKey)) continue;
      chosen.push(unit);
      selectedParents.add(unit.parentKey);
    }
    return chosen;
  }

  function buildQueue(units, now, boundaryHour, limits = DEFAULT_LIMITS) {
    const dayKey = localDayKey(now, boundaryHour);
    const selectedParents = new Set();
    const scheduledDue = units.filter(unit => unit.lane === 'scheduled' && !unit.sourceUnavailable && !unit.paused && !unit.stopped && unit.fsrsCard && new Date(unit.fsrsCard.effectiveDueAt || unit.fsrsCard.due) <= now);
    scheduledDue.sort((a, b) => new Date(a.fsrsCard.effectiveDueAt || a.fsrsCard.due) - new Date(b.fsrsCard.effectiveDueAt || b.fsrsCard.due));
    const due = takeDiverse(scheduledDue, limits.total, selectedParents, now, true);
    if (due.length >= limits.total) return snapshot(dayKey, now, due, [], []);

    let capacity = limits.total - due.length;
    const newCandidates = units.filter(unit => unit.lane === 'new' && !unit.sourceUnavailable && !unit.paused && !unit.stopped);
    const backlogCandidates = units.filter(unit => unit.lane === 'backlog' && !unit.sourceUnavailable && !unit.paused && !unit.stopped);
    const backlogPressure = Math.min(1, backlogCandidates.length / 100);
    const newAllowance = Math.min(limits.newMax, Math.max(newCandidates.length && capacity ? limits.newMin : 0, Math.floor(limits.newMax * (1 - backlogPressure * 0.6))));
    const newUnits = takeDiverse(newCandidates, Math.min(capacity, newAllowance), selectedParents, now);
    capacity -= newUnits.length;
    const backlogAllowance = Math.min(capacity, Math.max(0, Math.min(4, Math.ceil(backlogPressure * 4 + capacity / 8))));
    const backlogUnits = takeDiverse(backlogCandidates, backlogAllowance, selectedParents, now);
    return snapshot(dayKey, now, due, newUnits, backlogUnits);
  }

  function snapshot(dayKey, now, due, newUnits, backlogUnits) {
    return {
      dayKey,
      createdAt: now.toISOString(),
      items: [
        ...due.map(unit => ({ unitId: unit.id, source: 'due' })),
        ...newUnits.map(unit => ({ unitId: unit.id, source: 'new' })),
        ...backlogUnits.map(unit => ({ unitId: unit.id, source: 'backlog' }))
      ],
      stats: { due: due.length, new: newUnits.length, backlog: backlogUnits.length }
    };
  }

  const api = { DEFAULT_LIMITS, PRIORITY, localDayKey, startOfLocalDay, scoreCandidate, takeDiverse, buildQueue };
  if (typeof module !== 'undefined') module.exports = api;
  root.ReviewTabQueue = api;
}(this));
