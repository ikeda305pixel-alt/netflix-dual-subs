/**
 * Netflix Ad-Break & Skip Controller
 * - Detects ad breaks via Netflix player DOM attributes and classes
 * - Automatically mutes and speeds up video playback during ads, restoring user state afterwards
 * - Clicks available ad skip / close buttons and hides promotional banners/overlays
 * - Automatically clicks "Skip Intro", "Skip Recap", and "Next Episode" buttons
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NetflixAdBlocker = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const AD_INDICATOR_SELECTORS = [
    '[data-uia="ads-info-container"]',
    '[data-uia="ad-Pod-Counter"]',
    '[data-uia="ads-info-text"]',
    '.watch-video--ads-info-container',
    '.PlayerControlsNeo__ad-badge',
    '.ad-break-indicator'
  ];

  const AD_SKIP_BUTTON_SELECTORS = [
    '[data-uia="ad-skip-button"]',
    '[data-uia="ads-skip-button"]',
    '.watch-video--ad-skip-button',
    'button[aria-label*="Skip Ad" i]',
    'button[aria-label*="広告をスキップ" i]'
  ];

  const PROMO_OVERLAY_SELECTORS = [
    '[data-uia="billboard-pane-ad"]',
    '[data-uia="promo-banner"]',
    '.OriginalsLogo--billboard-ad',
    '.billboard-row .sponsored-badge',
    '.pause-ads-overlay',
    '[data-uia="pause-ad-container"]'
  ];

  const SKIP_INTRO_SELECTORS = [
    'button[data-uia="player-skip-intro"]',
    'button[data-uia="player-skip-recap"]',
    'button[data-uia="player-skip-preplay"]'
  ];

  const NEXT_EPISODE_SELECTORS = [
    'button[data-uia="next-episode-seamless-button"]',
    'button[data-uia="next-episode-seamless-button-draining"]'
  ];

  /**
   * Checks if any element matching the given CSS selector list exists and is visible.
   */
  function findMatchingElements(doc, selectors) {
    if (!doc || typeof doc.querySelectorAll !== 'function') {
      return [];
    }
    const combined = selectors.join(', ');
    try {
      return Array.from(doc.querySelectorAll(combined));
    } catch (_err) {
      return [];
    }
  }

  /**
   * Detects whether the player is currently in an ad break.
   */
  function isAdBreakActive(doc) {
    const matches = findMatchingElements(doc, AD_INDICATOR_SELECTORS);
    return matches.some((el) => {
      if (!el) return false;
      const hidden = el.hidden || (el.style && el.style.display === 'none');
      return !hidden;
    });
  }

  /**
   * Stateful controller that manages ad-break playback state, promo hiding, and intro skipping.
   */
  function createAdController(initialSettings = {}) {
    let settings = {
      adBlockEnabled: true,
      adAutoMute: true,
      adFastForwardRate: 4.0,
      hidePromoOverlays: true,
      autoSkipIntro: true,
      autoNextEpisode: false,
      ...initialSettings
    };

    let state = {
      inAdBreak: false,
      savedMuted: false,
      savedPlaybackRate: 1.0,
      adsHandledCount: 0,
      introsSkippedCount: 0,
      promosHiddenCount: 0,
      lastSkipClickTime: 0
    };

    function updateSettings(newSettings) {
      settings = { ...settings, ...newSettings };
    }

    function getStats() {
      return {
        inAdBreak: state.inAdBreak,
        adsHandledCount: state.adsHandledCount,
        introsSkippedCount: state.introsSkippedCount,
        promosHiddenCount: state.promosHiddenCount
      };
    }

    /**
     * Runs one inspection & enforcement cycle against the current document and video element.
     */
    function inspectAndEnforce(doc, videoEl, nowMs = Date.now()) {
      const actionsTaken = [];

      // 1. Hide promotional overlays & pause-screen ads
      if (settings.adBlockEnabled && settings.hidePromoOverlays) {
        const promos = findMatchingElements(doc, PROMO_OVERLAY_SELECTORS);
        for (const promo of promos) {
          if (promo && promo.style && promo.style.display !== 'none') {
            promo.style.display = 'none';
            promo.setAttribute('data-nf-dual-subs-hidden', 'true');
            state.promosHiddenCount += 1;
            actionsTaken.push('hide-promo');
          }
        }
      }

      // 2. Detect and handle video ad breaks
      if (settings.adBlockEnabled) {
        const adActive = isAdBreakActive(doc);

        if (adActive) {
          if (!state.inAdBreak) {
            state.inAdBreak = true;
            state.adsHandledCount += 1;
            if (videoEl) {
              state.savedMuted = Boolean(videoEl.muted);
              state.savedPlaybackRate = Number(videoEl.playbackRate) || 1.0;
            }
            actionsTaken.push('ad-break-started');
          }

          if (videoEl) {
            if (settings.adAutoMute && !videoEl.muted) {
              videoEl.muted = true;
              actionsTaken.push('ad-muted');
            }
            const targetRate = Number(settings.adFastForwardRate) || 4.0;
            if (targetRate > 1.0 && videoEl.playbackRate !== targetRate) {
              try {
                videoEl.playbackRate = targetRate;
                actionsTaken.push('ad-fast-forwarded');
              } catch (_err) {
                // Ignore if player restricts playbackRate
              }
            }
          }

          // Click any available ad skip button
          const skipAdButtons = findMatchingElements(doc, AD_SKIP_BUTTON_SELECTORS);
          for (const btn of skipAdButtons) {
            if (btn && typeof btn.click === 'function') {
              btn.click();
              actionsTaken.push('ad-skip-clicked');
            }
          }
        } else if (state.inAdBreak) {
          // Ad break finished -> restore user's original mute & playbackRate
          state.inAdBreak = false;
          if (videoEl) {
            videoEl.muted = state.savedMuted;
            try {
              videoEl.playbackRate = state.savedPlaybackRate || 1.0;
            } catch (_err) {
              // Ignore
            }
          }
          actionsTaken.push('ad-break-restored');
        }
      }

      // 3. Auto-skip Intro / Recap
      if (settings.autoSkipIntro && nowMs - state.lastSkipClickTime > 1200) {
        const skipBtns = findMatchingElements(doc, SKIP_INTRO_SELECTORS);
        for (const btn of skipBtns) {
          if (btn && typeof btn.click === 'function') {
            btn.click();
            state.introsSkippedCount += 1;
            state.lastSkipClickTime = nowMs;
            actionsTaken.push('skip-intro-clicked');
            break;
          }
        }
      }

      // 4. Optional Auto Next Episode
      if (settings.autoNextEpisode && nowMs - state.lastSkipClickTime > 1200) {
        const nextBtns = findMatchingElements(doc, NEXT_EPISODE_SELECTORS);
        for (const btn of nextBtns) {
          if (btn && typeof btn.click === 'function') {
            btn.click();
            state.lastSkipClickTime = nowMs;
            actionsTaken.push('next-episode-clicked');
            break;
          }
        }
      }

      return {
        inAdBreak: state.inAdBreak,
        actionsTaken,
        stats: getStats()
      };
    }

    return {
      updateSettings,
      getStats,
      inspectAndEnforce
    };
  }

  return {
    AD_INDICATOR_SELECTORS,
    AD_SKIP_BUTTON_SELECTORS,
    PROMO_OVERLAY_SELECTORS,
    SKIP_INTRO_SELECTORS,
    NEXT_EPISODE_SELECTORS,
    findMatchingElements,
    isAdBreakActive,
    createAdController
  };
});
