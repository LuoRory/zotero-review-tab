/* global Zotero */
(function () {
  const PREFIX = 'extensions.review-tab.';
  const KEYS = ['enabled', 'openOnStartup', 'dailyCount', 'newCardLimit', 'readingDayStartHour', 'firstReviewDays'];
  function get(key) { return Zotero.Prefs.get(PREFIX + key, true); }
  function set(key, value) { Zotero.Prefs.set(PREFIX + key, value, true); }
  function load() { for (const key of KEYS) { const el = document.getElementById(key); if (el) el.checked = el.type === 'checkbox' ? !!get(key) : false; if (el && el.type !== 'checkbox') el.value = get(key); } }
  function save() { for (const key of KEYS) { const el = document.getElementById(key); if (el) set(key, el.type === 'checkbox' ? el.checked : Number(el.value)); } }
  document.addEventListener('DOMContentLoaded', () => { load(); document.getElementById('save').addEventListener('click', save); document.getElementById('open').addEventListener('click', () => { save(); window.opener?.ReviewTabPlugin?.openReviewTab(window.opener); }); });
}());
