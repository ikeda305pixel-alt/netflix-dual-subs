/**
 * Netflix Dual Subtitles & Ad Blocker Content Script
 */
(function () {
  'use strict';

  const Parser = globalThis.NetflixSubtitleParser;
  const AdBlocker = globalThis.NetflixAdBlocker;

  if (!Parser || !AdBlocker) {
    return;
  }

  const DEFAULT_SETTINGS = {
    dualSubsEnabled: true,
    swapOrder: false,
    primaryFontSize: 26,
    secondaryFontSize: 20,
    bgOpacity: 0.75,
    offsetMs: 0,
    hideNativeSubsWhenDualReady: true,
    adBlockEnabled: true,
    adAutoMute: true,
    adFastForwardRate: 4.0,
    hidePromoOverlays: true,
    autoSkipIntro: true,
    autoNextEpisode: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  const subtitleTracks = {
    ja: [],
    en: []
  };

  const adController = AdBlocker.createAdController(settings);
  let overlayContainer = null;
  let overlayBox = null;
  let topLineEl = null;
  let bottomLineEl = null;
  let adBadgeEl = null;

  // 1. Inject MAIN-world network interceptor script
  function injectPageInterceptor() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.getURL) return;
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/injected-interceptor.js');
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (_err) {
      // Ignore in restricted frames
    }
  }

  // 2. Listen for intercepted subtitle payloads from page context
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== 'NF_DUAL_SUBS_INTERCEPTOR') return;

    if (event.data.type === 'SUBTITLE_PAYLOAD') {
      const { lang, payload } = event.data;
      const parsedCues = Parser.parseSubtitlePayload(payload);
      if (parsedCues.length > 0) {
        if (lang && lang.startsWith('ja')) {
          subtitleTracks.ja = parsedCues;
        } else {
          subtitleTracks.en = parsedCues;
        }
      }
    }
  });

  // 3. Create or update DOM overlay for Dual Subtitles & Ad Badge
  function ensureOverlayElements() {
    if (!document.body) return;

    if (!overlayContainer || !document.body.contains(overlayContainer)) {
      overlayContainer = document.createElement('div');
      overlayContainer.id = 'nf-dual-subs-container';

      overlayBox = document.createElement('div');
      overlayBox.className = 'nf-dual-subs-box';

      topLineEl = document.createElement('div');
      topLineEl.className = 'nf-dual-subs-top';

      bottomLineEl = document.createElement('div');
      bottomLineEl.className = 'nf-dual-subs-bottom';

      overlayBox.appendChild(topLineEl);
      overlayBox.appendChild(bottomLineEl);
      overlayContainer.appendChild(overlayBox);
      document.body.appendChild(overlayContainer);
    }

    if (!adBadgeEl || !document.body.contains(adBadgeEl)) {
      adBadgeEl = document.createElement('div');
      adBadgeEl.id = 'nf-ad-status-badge';
      adBadgeEl.textContent = '広告ブロック作動中 (自動ミュート・倍速スキップ)';
      document.body.appendChild(adBadgeEl);
    }

    applyVisualSettings();
  }

  function applyVisualSettings() {
    if (!overlayContainer) return;
    overlayContainer.style.setProperty('--nf-subs-primary-size', `${settings.primaryFontSize}px`);
    overlayContainer.style.setProperty('--nf-subs-secondary-size', `${settings.secondaryFontSize}px`);
    overlayContainer.style.setProperty('--nf-subs-bg', `rgba(10, 12, 16, ${settings.bgOpacity})`);
  }

  // Fallback: read currently rendered native Netflix DOM subtitles if one of the tracks hasn't been intercepted yet
  function readNativeNetflixDomSubtitles() {
    const timedTextContainer = document.querySelector('.player-timedtext-text-container, [data-uia="player-timedtext"]');
    if (!timedTextContainer) return '';
    const text = (timedTextContainer.innerText || timedTextContainer.textContent || '').trim();
    return text;
  }

  function renderCycle() {
    ensureOverlayElements();
    const videoEl = document.querySelector('video');

    // Run Ad-Blocker & Intro Skipper inspection
    const adResult = adController.inspectAndEnforce(document, videoEl, Date.now());
    if (adBadgeEl) {
      adBadgeEl.classList.toggle('active', Boolean(adResult.inAdBreak));
    }

    // Render Dual Subtitles
    if (!settings.dualSubsEnabled || !videoEl || adResult.inAdBreak) {
      if (overlayContainer) {
        overlayContainer.classList.add('nf-dual-subs-hidden');
      }
      return;
    }

    const currentTimeMs = Math.round((videoEl.currentTime || 0) * 1000);
    let { topText, bottomText } = Parser.getDualSubtitlesAt({
      primaryCues: subtitleTracks.ja,
      secondaryCues: subtitleTracks.en,
      currentTimeMs,
      offsetMs: Number(settings.offsetMs) || 0,
      swapOrder: Boolean(settings.swapOrder)
    });

    // If native DOM subtitle exists and one of our tracks is still empty, supplement from DOM
    if (!topText && !bottomText) {
      const nativeText = readNativeNetflixDomSubtitles();
      if (nativeText) {
        topText = nativeText;
      }
    }

    // Hide native Netflix subtitle container if both tracks are loaded to avoid double rendering
    const nativeContainer = document.querySelector('.player-timedtext');
    if (nativeContainer) {
      const bothTracksReady = subtitleTracks.ja.length > 0 && subtitleTracks.en.length > 0;
      nativeContainer.style.opacity =
        settings.hideNativeSubsWhenDualReady && bothTracksReady ? '0' : '1';
    }

    if (!topText && !bottomText) {
      overlayContainer.classList.add('nf-dual-subs-hidden');
      return;
    }

    overlayContainer.classList.remove('nf-dual-subs-hidden');
    topLineEl.textContent = topText;
    topLineEl.style.display = topText ? 'block' : 'none';
    bottomLineEl.textContent = bottomText;
    bottomLineEl.style.display = bottomText ? 'block' : 'none';
  }

  // 4. Keyboard shortcuts on Netflix watch page
  // Alt+D: Toggle Dual Subtitles | Alt+S: Swap JA/EN order | [ / ]: Adjust subtitle offset by ±250ms
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      settings.dualSubsEnabled = !settings.dualSubsEnabled;
      saveSettings();
    } else if (e.altKey && (e.key === 's' || e.key === 'S')) {
      settings.swapOrder = !settings.swapOrder;
      saveSettings();
    } else if (e.key === '[') {
      settings.offsetMs = (Number(settings.offsetMs) || 0) - 250;
      saveSettings();
    } else if (e.key === ']') {
      settings.offsetMs = (Number(settings.offsetMs) || 0) + 250;
      saveSettings();
    }
  });

  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        settings = { ...DEFAULT_SETTINGS, ...stored };
        adController.updateSettings(settings);
        applyVisualSettings();
      });

      chrome.storage.onChanged.addListener((changes) => {
        for (const [key, change] of Object.entries(changes)) {
          settings[key] = change.newValue;
        }
        adController.updateSettings(settings);
        applyVisualSettings();
      });
    }
  }

  function saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(settings);
    }
  }

  // Respond to status inquiries from Popup UI
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'GET_NF_STATUS') {
        sendResponse({
          jaCueCount: subtitleTracks.ja.length,
          enCueCount: subtitleTracks.en.length,
          adStats: adController.getStats(),
          settings
        });
        return true;
      }
      return false;
    });
  }

  injectPageInterceptor();
  loadSettings();
  setInterval(renderCycle, 150);
})();
