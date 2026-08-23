import { describe, expect, it } from 'vitest';
import { detectSubtitleFormat, parseSubtitle } from './study-subtitles';

describe('study subtitles', () => {
  it('parses SRT cues and removes markup', () => {
    expect(
      parseSubtitle(
        '1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i> world.\n',
        'srt',
      ),
    ).toEqual([{ text: 'Hello world.', startSeconds: 1, endSeconds: 3.5 }]);
  });

  it('parses LRC timestamps and derives cue ends', () => {
    expect(parseSubtitle('[00:01.20]First\n[00:03.00]Second', 'lrc')).toEqual([
      { text: 'First', startSeconds: 1.2, endSeconds: 3 },
      { text: 'Second', startSeconds: 3, endSeconds: 8 },
    ]);
  });

  it('splits plain text without requiring speech recognition', () => {
    expect(
      parseSubtitle('Hello world. Is this working? Yes!', 'plain-text'),
    ).toHaveLength(3);
  });

  it('detects formats from file names', () => {
    expect(detectSubtitleFormat('lesson.vtt')).toBe('vtt');
    expect(detectSubtitleFormat('lesson.txt')).toBe('plain-text');
  });
});
