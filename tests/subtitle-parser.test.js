const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('../src/subtitle-parser.js');

test('parseTimestampToMs converts Netflix DFXP ticks, seconds, and HH:MM:SS.mmm formats accurately', () => {
  assert.equal(Parser.parseTimestampToMs('150000000t', 10000000), 15000);
  assert.equal(Parser.parseTimestampToMs('25000000t', 10000000), 2500);
  assert.equal(Parser.parseTimestampToMs('12.5s'), 12500);
  assert.equal(Parser.parseTimestampToMs('00:01:02.500'), 62500);
  assert.equal(Parser.parseTimestampToMs('01:05,250'), 65250);
});

test('parseTtmlXml parses Netflix Japanese and English TTML/DFXP XML subtitles', () => {
  const sampleTtml = `<?xml version="1.0" encoding="UTF-8"?>
  <tt xmlns="http://www.w3.org/ns/ttml" tt:tickRate="10000000" xml:lang="ja">
    <body>
      <div>
        <p begin="10000000t" end="35000000t"><span>こんにちは、世界！</span><br/><span>調子はどう？</span></p>
        <p begin="40000000t" end="60000000t">準備はいいかい？</p>
      </div>
    </body>
  </tt>`;

  const cues = Parser.parseTtmlXml(sampleTtml);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], {
    startMs: 1000,
    endMs: 3500,
    text: 'こんにちは、世界！\n調子はどう？'
  });
  assert.deepEqual(cues[1], {
    startMs: 4000,
    endMs: 6000,
    text: '準備はいいかい？'
  });
});

test('parseWebVtt parses WebVTT cues and strips styling tags', () => {
  const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500 line:85%
<c.en>Hello, world!</c.en>
How are you doing?

2
00:00:04.000 --> 00:00:06.000
Are you ready?
`;

  const cues = Parser.parseWebVtt(sampleVtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3500);
  assert.equal(cues[0].text, 'Hello, world!\nHow are you doing?');
});

test('getDualSubtitlesAt aligns Japanese and English tracks with offset and swapOrder support', () => {
  const jaCues = [
    { startMs: 1000, endMs: 3500, text: 'こんにちは、世界！' },
    { startMs: 4000, endMs: 6000, text: '準備はいいかい？' }
  ];
  const enCues = [
    { startMs: 1000, endMs: 3500, text: 'Hello, world!' },
    { startMs: 4000, endMs: 6000, text: 'Are you ready?' }
  ];

  // Normal order at t=2000ms
  const res1 = Parser.getDualSubtitlesAt({
    primaryCues: jaCues,
    secondaryCues: enCues,
    currentTimeMs: 2000,
    offsetMs: 0,
    swapOrder: false
  });
  assert.deepEqual(res1, {
    topText: 'こんにちは、世界！',
    bottomText: 'Hello, world!'
  });

  // Swapped order at t=4500ms
  const res2 = Parser.getDualSubtitlesAt({
    primaryCues: jaCues,
    secondaryCues: enCues,
    currentTimeMs: 4500,
    offsetMs: 0,
    swapOrder: true
  });
  assert.deepEqual(res2, {
    topText: 'Are you ready?',
    bottomText: '準備はいいかい？'
  });

  // Offset adjustment (+500ms means subtitles appear 500ms later, so at 4200ms with +500ms offset, target is 3700ms -> empty)
  const res3 = Parser.getDualSubtitlesAt({
    primaryCues: jaCues,
    secondaryCues: enCues,
    currentTimeMs: 4200,
    offsetMs: 500,
    swapOrder: false
  });
  assert.deepEqual(res3, {
    topText: '',
    bottomText: ''
  });
});
