// ==UserScript==
// @name         Netflix 日英デュアル字幕 & 広告自動4倍速スキップ
// @namespace    https://github.com/ikeda305pixel-alt/netflix-dual-subs
// @version      1.1.0
// @description  Netflixで日本語と英語の同時字幕を表示し、広告再生時の自動4倍速スキップ＆自動ミュート、イントロ自動スキップを実行します。
// @author       ikeda305pixel-alt
// @match        *://*.netflix.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Netflix Dual Subs & Ad 4x Skip] Initializing on', window.location.href);

  // --- Configuration ---
  const CONFIG = {
    adFastForwardRate: 4.0, // 広告時の倍速スピード (4.0x)
    enableDualSubs: true,
    autoSkipIntro: true
  };

  // --- Ad-Break Controller & 4x Skip ---
  let isAdActive = false;
  let savedMuted = false;
  let savedRate = 1.0;

  const AD_SELECTORS = [
    '[data-uia="ads-info-container"]',
    '[data-uia="ad-Pod-Counter"]',
    '[data-uia="ads-info-text"]',
    '.watch-video--ads-info-container',
    '.PlayerControlsNeo__ad-badge',
    '.ad-break-indicator'
  ];

  const AD_SKIP_BUTTONS = [
    '[data-uia="ad-skip-button"]',
    '[data-uia="ads-skip-button"]',
    '.watch-video--ad-skip-button',
    'button[aria-label*="Skip Ad" i]',
    'button[aria-label*="広告をスキップ" i]'
  ];

  const INTRO_SKIP_BUTTONS = [
    'button[data-uia="player-skip-intro"]',
    'button[data-uia="player-skip-recap"]',
    'button[data-uia="player-skip-preplay"]',
    'button[data-uia="next-episode-seamless-button"]'
  ];

  function checkAndHandleAds() {
    const video = document.querySelector('video');
    const adElements = AD_SELECTORS.flatMap((s) => Array.from(document.querySelectorAll(s)));
    const adDetected = adElements.some((el) => el && !el.hidden && el.style.display !== 'none');

    if (adDetected) {
      if (!isAdActive) {
        isAdActive = true;
        if (video) {
          savedMuted = video.muted;
          savedRate = video.playbackRate || 1.0;
        }
        showStatusToast('⚡ 広告を4倍速スキップ＆ミュート中');
      }

      if (video) {
        video.muted = true;
        try {
          video.playbackRate = CONFIG.adFastForwardRate;
        } catch (_err) {}
      }

      // Auto-click any skip button
      for (const sel of AD_SKIP_BUTTONS) {
        const btn = document.querySelector(sel);
        if (btn && typeof btn.click === 'function') {
          btn.click();
          break;
        }
      }
    } else if (isAdActive) {
      // Ad ended -> restore normal playback
      isAdActive = false;
      if (video) {
        video.muted = savedMuted;
        try {
          video.playbackRate = savedRate;
        } catch (_err) {}
      }
      hideStatusToast();
    }

    // Auto-skip intro
    if (CONFIG.autoSkipIntro) {
      for (const sel of INTRO_SKIP_BUTTONS) {
        const btn = document.querySelector(sel);
        if (btn && typeof btn.click === 'function') {
          btn.click();
          break;
        }
      }
    }
  }

  // --- Subtitle Parser & Dual Overlay ---
  const subtitleTracks = { ja: [], en: [] };
  let overlayContainer = null;
  let topEl = null;
  let bottomEl = null;

  function ensureOverlay() {
    if (overlayContainer && document.body.contains(overlayContainer)) return;
    if (!document.body) return;

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'nf-dual-subs-overlay-userscript';
    overlayContainer.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 8%;
      transform: translateX(-50%);
      z-index: 2147483647;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      text-align: center;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: rgba(10, 12, 16, 0.78);
      padding: 6px 14px;
      border-radius: 8px;
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;

    topEl = document.createElement('div');
    topEl.style.cssText = 'color: #ffffff; font-size: 20px; font-weight: 700; line-height: 1.35; text-shadow: 0 2px 4px #000;';

    bottomEl = document.createElement('div');
    bottomEl.style.cssText = 'color: #ffd966; font-size: 16px; font-weight: 600; line-height: 1.35; text-shadow: 0 2px 4px #000; margin-top: 2px;';

    box.appendChild(topEl);
    box.appendChild(bottomEl);
    overlayContainer.appendChild(box);
    document.body.appendChild(overlayContainer);
  }

  function renderSubtitles() {
    const video = document.querySelector('video');
    if (!video || isAdActive || !CONFIG.enableDualSubs) {
      if (overlayContainer) overlayContainer.style.display = 'none';
      return;
    }

    ensureOverlay();
    const currentMs = Math.round((video.currentTime || 0) * 1000);

    const jaText = getActiveText(subtitleTracks.ja, currentMs);
    const enText = getActiveText(subtitleTracks.en, currentMs);

    // Fallback: read Netflix native DOM subtitle
    const nativeSubEl = document.querySelector('.player-timedtext-text-container, [data-uia="player-timedtext"]');
    const nativeText = nativeSubEl ? (nativeSubEl.innerText || '').trim() : '';

    const displayTop = jaText || nativeText;
    const displayBottom = enText;

    if (!displayTop && !displayBottom) {
      overlayContainer.style.display = 'none';
      return;
    }

    overlayContainer.style.display = 'flex';
    topEl.textContent = displayTop;
    topEl.style.display = displayTop ? 'block' : 'none';
    bottomEl.textContent = displayBottom;
    bottomEl.style.display = displayBottom ? 'block' : 'none';
  }

  function getActiveText(cues, targetMs) {
    if (!cues || cues.length === 0) return '';
    for (const cue of cues) {
      if (cue.startMs > targetMs) break;
      if (targetMs >= cue.startMs && targetMs <= cue.endMs) {
        return cue.text;
      }
    }
    return '';
  }

  // --- Network Interception for Subtitles ---
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const resp = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (url.includes('.xml') || url.includes('.dfxp') || url.includes('.vtt') || url.includes('timedtext')) {
          resp.clone().text().then((text) => parseAndSaveSubtitle(url, text)).catch(() => {});
        }
      } catch (_e) {}
      return resp;
    };
  }

  function parseAndSaveSubtitle(url, text) {
    if (!text || text.length < 30) return;
    const isJa = url.includes('lang=ja') || /xml:lang="ja"/i.test(text) || (text.match(/[\u3040-\u30ff\u4e00-\u9faf]/g) || []).length > 10;
    const cues = parseCues(text);
    if (cues.length > 0) {
      if (isJa) {
        subtitleTracks.ja = cues;
      } else {
        subtitleTracks.en = cues;
      }
    }
  }

  function parseCues(xmlOrVtt) {
    const cues = [];
    const pRegex = /<p\b[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(xmlOrVtt)) !== null) {
      const startMs = parseTime(match[1]);
      const endMs = parseTime(match[2]);
      const text = match[3].replace(/<[^>]+>/g, '').trim();
      if (text && endMs > startMs) cues.push({ startMs, endMs, text });
    }
    return cues.sort((a, b) => a.startMs - b.startMs);
  }

  function parseTime(str) {
    if (!str) return 0;
    if (str.endsWith('t')) return Math.round((parseInt(str, 10) / 10000000) * 1000);
    const parts = str.replace(',', '.').split(':');
    if (parts.length === 3) {
      return Math.round((parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2])) * 1000);
    }
    return 0;
  }

  // --- Toast status display ---
  let toastEl = null;
  function showStatusToast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        background: rgba(229, 9, 20, 0.9); color: #fff; padding: 6px 12px;
        border-radius: 999px; font-size: 12px; font-weight: bold; pointer-events: none;
      `;
      document.body && document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.display = 'block';
  }

  function hideStatusToast() {
    if (toastEl) toastEl.style.display = 'none';
  }

  // Run periodic loop
  setInterval(() => {
    checkAndHandleAds();
    renderSubtitles();
  }, 200);
})();
