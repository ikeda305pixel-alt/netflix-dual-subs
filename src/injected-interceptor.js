/**
 * Page-context interceptor for Netflix timedtext subtitle streams and player API.
 * Captures TTML/DFXP XML, WebVTT, and metadata JSON responses to extract Japanese & English tracks.
 */
(function () {
  'use strict';

  if (window.__NF_DUAL_SUBS_INTERCEPTOR_INSTALLED__) {
    return;
  }
  window.__NF_DUAL_SUBS_INTERCEPTOR_INSTALLED__ = true;

  const SUBTITLE_HINT_REGEX = /(\?o=\d+|\.dfxp|\.xml|\.vtt|timedtext|subtitles)/i;

  function detectLanguageFromPayloadOrUrl(url, text) {
    const lowerUrl = (url || '').toLowerCase();
    // Match xml:lang="ja" or lang="en" in TTML/DFXP
    const xmlLangMatch = text.match(/\b(?:xml:)?lang\s*=\s*["']([a-zA-Z-]+)["']/i);
    if (xmlLangMatch) {
      const code = xmlLangMatch[1].toLowerCase();
      if (code.startsWith('ja')) return 'ja';
      if (code.startsWith('en')) return 'en';
      return code;
    }

    if (/[?&]lang=ja/i.test(lowerUrl)) return 'ja';
    if (/[?&]lang=en/i.test(lowerUrl)) return 'en';

    // Heuristic: check ratio of Japanese kana/kanji characters vs ASCII letters
    const sample = text.replace(/<[^>]+>/g, '').slice(0, 4000);
    const jaChars = (sample.match(/[\u3040-\u30ff\u4e00-\u9faf]/g) || []).length;
    if (jaChars > 10) {
      return 'ja';
    }
    return 'en';
  }

  function looksLikeSubtitlePayload(text) {
    if (!text || typeof text !== 'string' || text.length < 30) {
      return false;
    }
    const head = text.slice(0, 1200);
    return (
      (head.includes('<tt') && text.includes('<p ')) ||
      head.startsWith('WEBVTT') ||
      (head.includes('"events"') && head.includes('"tStartMs"'))
    );
  }

  function emitSubtitlePayload(url, text, explicitLang) {
    if (!looksLikeSubtitlePayload(text)) return;
    const lang = explicitLang || detectLanguageFromPayloadOrUrl(url, text);
    window.postMessage(
      {
        source: 'NF_DUAL_SUBS_INTERCEPTOR',
        type: 'SUBTITLE_PAYLOAD',
        lang,
        url,
        payload: text
      },
      '*'
    );
  }

  // 1. Intercept window.fetch
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const reqUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (SUBTITLE_HINT_REGEX.test(reqUrl) || reqUrl.includes('nflxvideo.net')) {
          const clone = response.clone();
          clone
            .text()
            .then((text) => emitSubtitlePayload(reqUrl, text))
            .catch(() => {});
        }
      } catch (_err) {
        // Ignore
      }
      return response;
    };
  }

  // 2. Intercept XMLHttpRequest
  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const origOpen = OriginalXHR.prototype.open;
    const origSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method, url, ...rest) {
      this.__nfDualSubsUrl = typeof url === 'string' ? url : String(url || '');
      return origOpen.call(this, method, url, ...rest);
    };

    OriginalXHR.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = this.__nfDualSubsUrl || '';
          if (
            (this.responseType === '' || this.responseType === 'text') &&
            typeof this.responseText === 'string' &&
            (SUBTITLE_HINT_REGEX.test(url) || url.includes('nflxvideo.net'))
          ) {
            emitSubtitlePayload(url, this.responseText);
          }
        } catch (_err) {
          // Ignore
        }
      });
      return origSend.apply(this, args);
    };
  }

  // 3. Periodically probe Netflix Cadillac player API to pre-warm both Japanese & English tracks
  let lastProbedVideoId = null;
  function tryPrewarmNetflixTracks() {
    try {
      const netflixObj = window.netflix;
      if (!netflixObj || !netflixObj.appContext || !netflixObj.appContext.state) return;
      const playerApp = netflixObj.appContext.state.playerApp;
      if (!playerApp || typeof playerApp.getAPI !== 'function') return;
      const videoPlayer = playerApp.getAPI().videoPlayer;
      if (!videoPlayer || typeof videoPlayer.getAllPlayerSessionIds !== 'function') return;

      const sessionIds = videoPlayer.getAllPlayerSessionIds();
      if (!sessionIds || sessionIds.length === 0) return;
      const player = videoPlayer.getVideoPlayerBySessionId(sessionIds[0]);
      if (!player || typeof player.getTimedTextTrackList !== 'function') return;

      const movieId = typeof player.getMovieId === 'function' ? player.getMovieId() : sessionIds[0];
      if (movieId === lastProbedVideoId) return;
      lastProbedVideoId = movieId;

      const tracks = player.getTimedTextTrackList() || [];
      const currentTrack = typeof player.getTimedTextTrack === 'function' ? player.getTimedTextTrack() : null;

      const jaTrack = tracks.find(
        (t) => t && t.bcp47 && t.bcp47.toLowerCase().startsWith('ja') && !t.isNoneTrack
      );
      const enTrack = tracks.find(
        (t) => t && t.bcp47 && t.bcp47.toLowerCase().startsWith('en') && !t.isNoneTrack
      );

      // Briefly cycle track selection so Netflix fetches both language subtitle files
      if (jaTrack && enTrack && typeof player.setTimedTextTrack === 'function') {
        player.setTimedTextTrack(enTrack);
        setTimeout(() => {
          player.setTimedTextTrack(jaTrack);
          if (currentTrack) {
            setTimeout(() => {
              player.setTimedTextTrack(currentTrack);
            }, 600);
          }
        }, 600);
      }
    } catch (_err) {
      // Ignore if player API is not ready
    }
  }

  setInterval(tryPrewarmNetflixTracks, 4000);
})();
