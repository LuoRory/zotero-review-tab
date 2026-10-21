/* global Zotero */
(function () {
  const PREFIX = 'extensions.review-tab.';
  const KEYS = ['enabled', 'openOnStartup', 'dailyCount', 'newCardLimit', 'backlogThreshold', 'backlogDailyLimit', 'readingDayStartHour', 'firstReviewDays'];
  function get(key) { return Zotero.Prefs.get(PREFIX + key, true); }
  function set(key, value) { Zotero.Prefs.set(PREFIX + key, value, true); }
  function load() {
    for (const key of KEYS) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!get(key);
      else el.value = get(key);
    }
  }
  function save() {
    for (const key of KEYS) {
      const el = document.getElementById(key);
      if (!el || el.type !== 'number') continue;
      const value = Number(el.value);
      if (el.value.trim() === '' || !Number.isInteger(value) || value < Number(el.min) || value > Number(el.max)) {
        el.focus();
        el.setCustomValidity(`Enter a whole number from ${el.min} to ${el.max}.`);
        el.reportValidity();
        return false;
      }
      el.setCustomValidity('');
    }
    for (const key of KEYS) {
      const el = document.getElementById(key);
      if (el) set(key, el.type === 'checkbox' ? el.checked : Number(el.value));
    }
    return true;
  }
  document.addEventListener('DOMContentLoaded', () => {
    load();
    for (const el of document.querySelectorAll('input[type="number"]')) el.addEventListener('input', () => el.setCustomValidity(''));
    document.getElementById('save').addEventListener('click', save);
    document.getElementById('open').addEventListener('click', () => { if (save()) window.opener?.ReviewTabPlugin?.openReviewTab(window.opener); });
  });
}());
