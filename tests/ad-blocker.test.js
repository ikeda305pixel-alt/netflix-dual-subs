const test = require('node:test');
const assert = require('node:assert/strict');
const AdBlocker = require('../src/ad-blocker.js');

function createMockDoc({ adElements = [], adSkipButtons = [], promoElements = [], skipIntroButtons = [] } = {}) {
  return {
    querySelectorAll(selectorString) {
      if (selectorString.includes('ads-info-container')) {
        return adElements;
      }
      if (selectorString.includes('ad-skip-button')) {
        return adSkipButtons;
      }
      if (selectorString.includes('billboard-pane-ad')) {
        return promoElements;
      }
      if (selectorString.includes('player-skip-intro')) {
        return skipIntroButtons;
      }
      return [];
    }
  };
}

test('AdController mutes and fast-forwards video during ad breaks, then restores state after ad ends', () => {
  const controller = AdBlocker.createAdController({
    adBlockEnabled: true,
    adAutoMute: true,
    adFastForwardRate: 4.0,
    hidePromoOverlays: true,
    autoSkipIntro: true
  });

  const videoEl = {
    muted: false,
    playbackRate: 1.25
  };

  let adSkipClicked = false;
  const adDoc = createMockDoc({
    adElements: [{ hidden: false, style: { display: 'block' } }],
    adSkipButtons: [{ click: () => { adSkipClicked = true; } }]
  });

  // 1. Ad break starts
  const step1 = controller.inspectAndEnforce(adDoc, videoEl, 10000);
  assert.equal(step1.inAdBreak, true);
  assert.equal(videoEl.muted, true);
  assert.equal(videoEl.playbackRate, 4.0);
  assert.equal(adSkipClicked, true);
  assert.equal(step1.stats.adsHandledCount, 1);

  // 2. Ad break finishes -> restores user's original mute (false) and playbackRate (1.25)
  const normalDoc = createMockDoc({});
  const step2 = controller.inspectAndEnforce(normalDoc, videoEl, 12000);
  assert.equal(step2.inAdBreak, false);
  assert.equal(videoEl.muted, false);
  assert.equal(videoEl.playbackRate, 1.25);
});

test('AdController hides promotional overlays and auto-clicks Skip Intro buttons', () => {
  const controller = AdBlocker.createAdController({
    adBlockEnabled: true,
    hidePromoOverlays: true,
    autoSkipIntro: true
  });

  const promoEl = {
    style: { display: 'block' },
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
  };
  let introClicked = 0;
  const skipBtn = {
    click() {
      introClicked += 1;
    }
  };

  const doc = createMockDoc({
    promoElements: [promoEl],
    skipIntroButtons: [skipBtn]
  });

  const res = controller.inspectAndEnforce(doc, null, 5000);
  assert.equal(promoEl.style.display, 'none');
  assert.equal(promoEl.attrs['data-nf-dual-subs-hidden'], 'true');
  assert.equal(introClicked, 1);
  assert.equal(res.stats.promosHiddenCount, 1);
  assert.equal(res.stats.introsSkippedCount, 1);
});
