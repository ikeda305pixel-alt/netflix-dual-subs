(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    dualSubsEnabled: true,
    swapOrder: false,
    primaryFontSize: 26,
    secondaryFontSize: 20,
    bgOpacity: 0.75,
    offsetMs: 0,
    adBlockEnabled: true,
    adAutoMute: true,
    adFastForwardRate: 4.0,
    hidePromoOverlays: true,
    autoSkipIntro: true,
    autoNextEpisode: false
  };

  const CHECKBOX_IDS = [
    'dualSubsEnabled',
    'swapOrder',
    'adBlockEnabled',
    'adAutoMute',
    'hidePromoOverlays',
    'autoSkipIntro',
    'autoNextEpisode'
  ];

  const RANGE_CONFIGS = [
    { id: 'primaryFontSize', labelId: 'primaryFontSizeVal', format: (v) => `${v}px`, parse: Number },
    { id: 'secondaryFontSize', labelId: 'secondaryFontSizeVal', format: (v) => `${v}px`, parse: Number },
    { id: 'bgOpacity', labelId: 'bgOpacityVal', format: (v) => `${Math.round(v * 100)}%`, parse: Number },
    { id: 'offsetMs', labelId: 'offsetMsVal', format: (v) => `${v > 0 ? '+' : ''}${v} ms`, parse: Number },
    { id: 'adFastForwardRate', labelId: 'adFastForwardRateVal', format: (v) => `${Number(v).toFixed(1)}x`, parse: Number }
  ];

  function populateForm(settings) {
    for (const id of CHECKBOX_IDS) {
      const el = document.getElementById(id);
      if (el) {
        el.checked = Boolean(settings[id]);
      }
    }

    for (const cfg of RANGE_CONFIGS) {
      const el = document.getElementById(cfg.id);
      const label = document.getElementById(cfg.labelId);
      if (el && settings[cfg.id] !== undefined) {
        el.value = settings[cfg.id];
        if (label) {
          label.textContent = cfg.format(settings[cfg.id]);
        }
      }
    }
  }

  function bindEvents() {
    for (const id of CHECKBOX_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('change', () => {
        if (chrome && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set({ [id]: el.checked });
        }
      });
    }

    for (const cfg of RANGE_CONFIGS) {
      const el = document.getElementById(cfg.id);
      const label = document.getElementById(cfg.labelId);
      if (!el) continue;
      el.addEventListener('input', () => {
        const val = cfg.parse(el.value);
        if (label) {
          label.textContent = cfg.format(val);
        }
        if (chrome && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.set({ [cfg.id]: val });
        }
      });
    }
  }

  function queryActiveTabStatus() {
    if (!chrome || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      if (!activeTab || !activeTab.id) return;
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_NF_STATUS' }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        const jaEl = document.getElementById('stat-ja');
        const enEl = document.getElementById('stat-en');
        const adsEl = document.getElementById('stat-ads');
        const skipsEl = document.getElementById('stat-skips');

        if (jaEl) jaEl.textContent = resp.jaCueCount > 0 ? `${resp.jaCueCount} 行` : '待機中';
        if (enEl) enEl.textContent = resp.enCueCount > 0 ? `${resp.enCueCount} 行` : '待機中';
        if (adsEl && resp.adStats) adsEl.textContent = `${resp.adStats.adsHandledCount} 件`;
        if (skipsEl && resp.adStats) skipsEl.textContent = `${resp.adStats.introsSkippedCount} 回`;
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        populateForm({ ...DEFAULT_SETTINGS, ...stored });
      });
    } else {
      populateForm(DEFAULT_SETTINGS);
    }
    bindEvents();
    queryActiveTabStatus();
  });
})();
