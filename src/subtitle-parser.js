/**
 * Netflix Dual Subtitles Parser & Synchronizer
 * Supports:
 * - Netflix TTML / DFXP XML (both tick-based `12345678t` and `HH:MM:SS.mmm` timestamps)
 * - WebVTT (`WEBVTT`)
 * - JSON TimedText payloads (`events` array)
 * - Bilingual cue alignment & active cue lookup at current playback timestamp
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NetflixSubtitleParser = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_TICK_RATE = 10000000; // Netflix DFXP default tickRate="10000000" (10^7 ticks/sec)

  /**
   * Converts a timestamp string into milliseconds.
   * Supports:
   * - Tick strings: "150000000t" -> 15000 ms (with tickRate = 10000000)
   * - Seconds strings: "12.5s" -> 12500 ms
   * - Timecode strings: "00:01:23.456" or "01:23,456" or "00:01:23:12"
   */
  function parseTimestampToMs(raw, tickRate = DEFAULT_TICK_RATE) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.round(raw);
    }
    if (!raw || typeof raw !== 'string') {
      return 0;
    }
    const str = raw.trim();

    // Tick format: e.g. "125000000t"
    if (/^\d+t$/i.test(str)) {
      const ticks = parseInt(str.slice(0, -1), 10);
      const rate = tickRate > 0 ? tickRate : DEFAULT_TICK_RATE;
      return Math.round((ticks / rate) * 1000);
    }

    // Seconds format: e.g. "14.25s"
    if (/^\d+(\.\d+)?s$/i.test(str)) {
      return Math.round(parseFloat(str.slice(0, -1)) * 1000);
    }

    // Milliseconds format: e.g. "1500ms"
    if (/^\d+(\.\d+)?ms$/i.test(str)) {
      return Math.round(parseFloat(str.slice(0, -2)));
    }

    // Timecode format: HH:MM:SS.mmm or MM:SS.mmm or HH:MM:SS:FF
    const normalized = str.replace(',', '.');
    const parts = normalized.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const seconds = parseFloat(parts[2]) || 0;
      return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
    }
    if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10) || 0;
      const seconds = parseFloat(parts[1]) || 0;
      return Math.round((minutes * 60 + seconds) * 1000);
    }
    if (parts.length === 4) {
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const seconds = parseInt(parts[2], 10) || 0;
      const frames = parseInt(parts[3], 10) || 0;
      return Math.round((hours * 3600 + minutes * 60 + seconds + frames / 24) * 1000);
    }

    return 0;
  }

  /**
   * Cleans HTML/XML tags and decodes common HTML entities in subtitle text.
   */
  function cleanSubtitleText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return '';
    }
    return rawText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Parses Netflix TTML / DFXP XML content into sorted subtitle cues.
   */
  function parseTtmlXml(xmlContent) {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return [];
    }

    const tickRateMatch = xmlContent.match(/tickRate\s*=\s*["'](\d+)["']/i);
    const tickRate = tickRateMatch ? parseInt(tickRateMatch[1], 10) : DEFAULT_TICK_RATE;

    const cues = [];
    const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let match;

    while ((match = pRegex.exec(xmlContent)) !== null) {
      const attrs = match[1];
      const innerHtml = match[2];

      const beginMatch = attrs.match(/\bbegin\s*=\s*["']([^"']+)["']/i);
      const endMatch = attrs.match(/\bend\s*=\s*["']([^"']+)["']/i);
      const durMatch = attrs.match(/\bdur\s*=\s*["']([^"']+)["']/i);

      if (!beginMatch) continue;
      const startMs = parseTimestampToMs(beginMatch[1], tickRate);
      let endMs = 0;

      if (endMatch) {
        endMs = parseTimestampToMs(endMatch[1], tickRate);
      } else if (durMatch) {
        endMs = startMs + parseTimestampToMs(durMatch[1], tickRate);
      } else {
        endMs = startMs + 3000;
      }

      const text = cleanSubtitleText(innerHtml);
      if (text && endMs > startMs) {
        cues.push({ startMs, endMs, text });
      }
    }

    return mergeDuplicateTimestamps(cues);
  }

  /**
   * Parses WebVTT content into sorted subtitle cues.
   */
  function parseWebVtt(vttContent) {
    if (!vttContent || typeof vttContent !== 'string') {
      return [];
    }

    const normalized = vttContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split(/\n{2,}/);
    const cues = [];

    for (const block of blocks) {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0 || /^WEBVTT/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) {
        continue;
      }

      // Find the line containing "-->"
      const arrowIdx = lines.findIndex((l) => l.includes('-->'));
      if (arrowIdx === -1) continue;

      const timeLine = lines[arrowIdx];
      const arrowParts = timeLine.split('-->');
      if (arrowParts.length < 2) continue;

      const startRaw = arrowParts[0].trim().split(/\s+/)[0];
      const endRaw = arrowParts[1].trim().split(/\s+/)[0];

      const startMs = parseTimestampToMs(startRaw);
      const endMs = parseTimestampToMs(endRaw);
      const text = cleanSubtitleText(lines.slice(arrowIdx + 1).join('\n'));

      if (text && endMs > startMs) {
        cues.push({ startMs, endMs, text });
      }
    }

    return mergeDuplicateTimestamps(cues);
  }

  /**
   * Parses JSON timedtext payload (events array with tStartMs / dDurationMs / segs).
   */
  function parseJsonTimedText(jsonInput) {
    let data = jsonInput;
    if (typeof jsonInput === 'string') {
      try {
        data = JSON.parse(jsonInput);
      } catch (_err) {
        return [];
      }
    }
    if (!data || !Array.isArray(data.events)) {
      return [];
    }

    const cues = [];
    for (const ev of data.events) {
      const startMs = Number(ev.tStartMs ?? ev.startMs ?? 0);
      const durationMs = Number(ev.dDurationMs ?? ev.durationMs ?? 2500);
      const endMs = Number(ev.endMs ?? startMs + durationMs);
      let text = '';
      if (Array.isArray(ev.segs)) {
        text = cleanSubtitleText(ev.segs.map((s) => s.utf8 || s.text || '').join(''));
      } else if (typeof ev.text === 'string') {
        text = cleanSubtitleText(ev.text);
      }
      if (text && endMs > startMs) {
        cues.push({ startMs, endMs, text });
      }
    }

    return mergeDuplicateTimestamps(cues);
  }

  /**
   * Auto-detects format (TTML XML, WebVTT, or JSON) and parses subtitle payload.
   */
  function parseSubtitlePayload(payload) {
    if (!payload) return [];
    if (typeof payload === 'object') {
      return parseJsonTimedText(payload);
    }
    const trimmed = String(payload).trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return parseJsonTimedText(trimmed);
    }
    if (/^WEBVTT/i.test(trimmed) || trimmed.includes('-->')) {
      return parseWebVtt(trimmed);
    }
    if (trimmed.includes('<tt') || trimmed.includes('<p ')) {
      return parseTtmlXml(trimmed);
    }
    return [];
  }

  /**
   * Sorts cues and merges cues that have identical [startMs, endMs] intervals.
   */
  function mergeDuplicateTimestamps(cues) {
    const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const merged = [];

    for (const cue of sorted) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.startMs - cue.startMs) <= 50 && Math.abs(prev.endMs - cue.endMs) <= 50) {
        if (!prev.text.includes(cue.text)) {
          prev.text = `${prev.text}\n${cue.text}`;
        }
      } else {
        merged.push({ ...cue });
      }
    }
    return merged;
  }

  /**
   * Returns active subtitle text for a single track at currentTimeMs + offsetMs.
   */
  function getActiveTextAt(cues, currentTimeMs, offsetMs = 0) {
    if (!Array.isArray(cues) || cues.length === 0) {
      return '';
    }
    const targetMs = currentTimeMs - offsetMs;
    const activeLines = [];

    for (const cue of cues) {
      if (cue.startMs > targetMs) {
        break;
      }
      if (targetMs >= cue.startMs && targetMs <= cue.endMs) {
        activeLines.push(cue.text);
      }
    }
    return activeLines.join('\n');
  }

  /**
   * Returns both primary (e.g. Japanese) and secondary (e.g. English) subtitle strings
   * for the given playback time and user settings.
   */
  function getDualSubtitlesAt({
    primaryCues = [],
    secondaryCues = [],
    currentTimeMs = 0,
    offsetMs = 0,
    swapOrder = false
  }) {
    const primaryText = getActiveTextAt(primaryCues, currentTimeMs, offsetMs);
    const secondaryText = getActiveTextAt(secondaryCues, currentTimeMs, offsetMs);

    if (swapOrder) {
      return {
        topText: secondaryText,
        bottomText: primaryText
      };
    }
    return {
      topText: primaryText,
      bottomText: secondaryText
    };
  }

  return {
    DEFAULT_TICK_RATE,
    parseTimestampToMs,
    cleanSubtitleText,
    parseTtmlXml,
    parseWebVtt,
    parseJsonTimedText,
    parseSubtitlePayload,
    mergeDuplicateTimestamps,
    getActiveTextAt,
    getDualSubtitlesAt
  };
});
