(function (root) {
  const INTERVALS = [3, 10, 30, 90, 180];
  function readingDayKey(date, startHour) {
    const shifted = new Date(date.getTime());
    shifted.setHours(shifted.getHours() - startHour);
    return [shifted.getFullYear(), String(shifted.getMonth() + 1).padStart(2, '0'), String(shifted.getDate()).padStart(2, '0')].join('-');
  }
  function nextReviewAt(from, reviewCount, firstReviewDays) {
    const date = new Date(from.getTime());
    const days = reviewCount === 0 ? firstReviewDays : INTERVALS[Math.min(reviewCount, INTERVALS.length - 1)];
    date.setDate(date.getDate() + days);
    return date;
  }
  function recommendationScore(entry, now) {
    const overdueDays = Math.max(0, (now.getTime() - new Date(entry.dueAt).getTime()) / 86400000);
    const firstVisitBonus = entry.reviewCount === 0 ? 40 : 0;
    const activityBonus = Math.min(Number(entry.activityCount || 0), 20);
    return overdueDays * 10 + firstVisitBonus + activityBonus;
  }
  const api = { INTERVALS, readingDayKey, nextReviewAt, recommendationScore };
  if (typeof module !== 'undefined') module.exports = api;
  root.ReviewTabSchedule = api;
}(this));
