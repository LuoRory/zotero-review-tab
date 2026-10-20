(function (root) {
  const SCHEDULER_VERSION = 'ts-fsrs@5.4.2';

  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function dayOffset(cardId) {
    return (hash(cardId) % 3) - 1;
  }

  function localBoundary(dateValue, boundaryHour) {
    const date = new Date(dateValue);
    date.setHours(boundaryHour, 0, 0, 0);
    return date;
  }

  function applyDuePolicy(card, cardId, boundaryHour) {
    const shifted = new Date(card.due);
    shifted.setDate(shifted.getDate() + dayOffset(cardId));
    const effectiveDue = localBoundary(shifted, boundaryHour);
    return Object.assign({}, card, {
      due: new Date(card.due).toISOString(),
      effectiveDueAt: effectiveDue.toISOString(),
      jitterDays: dayOffset(cardId),
      last_review: card.last_review ? new Date(card.last_review).toISOString() : null
    });
  }

  function cardForScheduler(card) {
    const copy = Object.assign({}, card);
    copy.due = new Date(copy.due);
    if (copy.last_review) copy.last_review = new Date(copy.last_review);
    delete copy.effectiveDueAt;
    delete copy.jitterDays;
    return copy;
  }

  function logDTO(log) {
    return {
      rating: Number(log.rating),
      state: Number(log.state),
      due: new Date(log.due).toISOString(),
      review: new Date(log.review).toISOString(),
      stability: Number(log.stability),
      difficulty: Number(log.difficulty),
      elapsed_days: Number(log.elapsed_days),
      last_elapsed_days: Number(log.last_elapsed_days),
      scheduled_days: Number(log.scheduled_days),
      learning_steps: Number(log.learning_steps),
      schedulerVersion: SCHEDULER_VERSION
    };
  }

  function createAdapter(FSRS, parameters, boundaryHour) {
    const scheduler = FSRS.fsrs(Object.assign({ enable_fuzz: true }, parameters || {}));
    return {
      rating: FSRS.Rating,
      parameters: scheduler.parameters,
      createRatedCard(existingCard, unitId, now, grade) {
        const card = existingCard ? cardForScheduler(existingCard) : FSRS.createEmptyCard(now);
        const result = scheduler.next(card, now, grade);
        return { card: applyDuePolicy(result.card, unitId, boundaryHour), log: logDTO(result.log) };
      },
      retrievability(card, now) {
        return scheduler.get_retrievability(cardForScheduler(card), now, false);
      }
    };
  }

  const api = { SCHEDULER_VERSION, hash, dayOffset, localBoundary, applyDuePolicy, cardForScheduler, logDTO, createAdapter };
  if (typeof module !== 'undefined') module.exports = api;
  root.ReviewTabFSRS = api;
}(this));
