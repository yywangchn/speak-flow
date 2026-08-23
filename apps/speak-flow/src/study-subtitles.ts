export type StudySubtitleFormat = 'srt' | 'vtt' | 'lrc' | 'plain-text';

export type StudyCue = {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
};

const TIMESTAMP = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/;

export function detectSubtitleFormat(fileName: string): StudySubtitleFormat {
  const extension = fileName.toLowerCase().split('.').at(-1);
  if (extension === 'srt' || extension === 'vtt' || extension === 'lrc')
    return extension;
  return 'plain-text';
}

export function parseSubtitle(
  text: string,
  format: StudySubtitleFormat,
): StudyCue[] {
  if (format === 'lrc') return parseLrc(text);
  if (format === 'plain-text') return splitPlainText(text);
  return parseWebSubtitle(text, format);
}

function parseWebSubtitle(text: string, format: 'srt' | 'vtt'): StudyCue[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues: StudyCue[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index]?.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!timing) continue;
    const cueLines: string[] = [];
    for (index += 1; index < lines.length && lines[index]?.trim(); index += 1)
      cueLines.push(lines[index] ?? '');
    const cueText = cleanSubtitleText(cueLines.join(' '));
    if (cueText) {
      cues.push({
        text: cueText,
        startSeconds: parseTimestamp(timing[1]),
        endSeconds: parseTimestamp(timing[2]),
      });
    }
  }
  return format === 'vtt' ? cues : cues;
}

function parseLrc(text: string): StudyCue[] {
  const entries = text
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.+)$/);
      if (!match) return [];
      const fraction = Number(`0.${(match[3] ?? '').padEnd(3, '0')}`);
      return [
        {
          startSeconds: Number(match[1]) * 60 + Number(match[2]) + fraction,
          text: cleanSubtitleText(match[4]),
        },
      ];
    })
    .filter((entry) => entry.text)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  return entries.map((entry, index) => ({
    ...entry,
    endSeconds: entries[index + 1]?.startSeconds ?? entry.startSeconds + 5,
  }));
}

function splitPlainText(text: string): StudyCue[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [normalized];
  return sentences.map((sentence) => ({
    text: sentence.trim(),
    startSeconds: 0,
    endSeconds: 0,
  }));
}

function parseTimestamp(value: string): number {
  const match = value.match(TIMESTAMP);
  if (!match) throw new Error(`Invalid subtitle timestamp: ${value}`);
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}

function cleanSubtitleText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
