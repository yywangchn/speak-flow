import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

type Clip = {
  clientId: string;
  file: string;
  sentence: string;
  up: number;
  down: number;
  age: string;
  gender: string;
  accents: string;
};

async function main(): Promise<void> {
  const datasetArgument = process.argv[2];
  if (!datasetArgument)
    throw new Error(
      'Usage: tsx tools/voice-dataset/filter-common-voice.ts <dataset-dir> [output-dir]',
    );
  const dataset = resolve(datasetArgument);
  const output = resolve(process.argv[3] ?? join(dataset, 'filtered'));

  const escapeCsv = (value: string): string =>
    `"${value.replaceAll('"', '""')}"`;
  const rows: Clip[] = [];
  for (const split of ['train', 'dev', 'test']) {
    const path = join(dataset, `${split}.tsv`);
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/).filter(Boolean);
    const headers = lines[0].split('\t');
    const index = (name: string): number => headers.indexOf(name);
    for (const line of lines.slice(1)) {
      const fields = line.split('\t');
      const file = fields[index('path')];
      if (!file) continue;
      rows.push({
        clientId: fields[index('client_id')] ?? '',
        file,
        sentence: fields[index('sentence')] ?? '',
        up: Number(fields[index('up_votes')] ?? 0),
        down: Number(fields[index('down_votes')] ?? 0),
        age: fields[index('age')] ?? '',
        gender: fields[index('gender')] ?? '',
        accents: fields[index('accents')] ?? '',
      });
    }
  }

  const speakers = new Map<string, Clip[]>();
  for (const clip of rows)
    speakers.set(clip.clientId, [...(speakers.get(clip.clientId) ?? []), clip]);
  const ranked = [...speakers.entries()]
    .map(([clientId, clips]) => {
      const votes = clips.reduce((sum, clip) => sum + clip.up + clip.down, 0);
      const positive = clips.reduce((sum, clip) => sum + clip.up, 0);
      const quality = votes ? positive / votes : 0;
      const accents = [
        ...new Set(
          clips.flatMap((clip) => clip.accents.split('|').filter(Boolean)),
        ),
      ].join('|');
      const genders = [
        ...new Set(clips.map((clip) => clip.gender).filter(Boolean)),
      ].join('|');
      const ages = [
        ...new Set(clips.map((clip) => clip.age).filter(Boolean)),
      ].join('|');
      const samples = clips.slice(0, 3).map((clip) => ({
        path: resolve(dataset, 'clips', basename(clip.file)),
        sentence: clip.sentence,
      }));
      return {
        clientId,
        clipCount: clips.length,
        quality,
        positive,
        votes,
        accents,
        genders,
        ages,
        samples,
      };
    })
    .filter((speaker) => speaker.clipCount >= 10)
    .sort((a, b) => b.clipCount - a.clipCount || b.quality - a.quality);

  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, 'speakers.csv'),
    [
      'rank,client_id,clip_count,quality,up_votes,total_votes,age,gender,accents,sample_audio_1,sample_text_1,sample_audio_2,sample_text_2,sample_audio_3,sample_text_3',
      ...ranked.map((speaker, i) =>
        [
          i + 1,
          speaker.clientId,
          speaker.clipCount,
          speaker.quality.toFixed(3),
          speaker.positive,
          speaker.votes,
          speaker.ages,
          speaker.genders,
          speaker.accents,
          speaker.samples[0]?.path ?? '',
          speaker.samples[0]?.sentence ?? '',
          speaker.samples[1]?.path ?? '',
          speaker.samples[1]?.sentence ?? '',
          speaker.samples[2]?.path ?? '',
          speaker.samples[2]?.sentence ?? '',
        ]
          .map(String)
          .map(escapeCsv)
          .join(','),
      ),
    ].join('\n'),
  );

  const top = ranked.slice(0, 100);
  const clipLines = [
    'rank\tclient_id\taudio_path\tsentence\tup_votes\tdown_votes',
  ];
  for (const speaker of top) {
    for (const clip of speakers.get(speaker.clientId) ?? []) {
      clipLines.push(
        [
          ranked.indexOf(speaker) + 1,
          speaker.clientId,
          resolve(dataset, 'clips', basename(clip.file)),
          clip.sentence,
          clip.up,
          clip.down,
        ].join('\t'),
      );
    }
  }
  await writeFile(join(output, 'top-100-clips.tsv'), clipLines.join('\n'));
  console.log(`Read ${rows.length} clips from ${speakers.size} speakers.`);
  console.log(`Wrote ${join(output, 'speakers.csv')}`);
  console.log(`Wrote ${join(output, 'top-100-clips.tsv')}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
