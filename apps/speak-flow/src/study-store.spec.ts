import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type StudyMaterial } from './study-store';

const testDirectory = mkdtempSync(join(tmpdir(), 'speak-flow-study-'));
const testDatabasePath = join(testDirectory, 'test.sqlite');

process.env['SPEAKFLOW_DATABASE_PATH'] = testDatabasePath;

let studyStore: typeof import('./study-store');

beforeAll(async () => {
  studyStore = await import('./study-store');
});

afterAll(() => {
  delete process.env['SPEAKFLOW_DATABASE_PATH'];
  rmSync(testDirectory, { recursive: true, force: true });
});

function createMaterial(userId: string, title: string): StudyMaterial {
  return studyStore.createStudyMaterial({
    userId,
    title,
    audioPath: `/test-audio/${title}`,
    subtitlePath: `/test-subtitles/${title}.srt`,
    subtitleFormat: 'srt',
  });
}

describe('study store', () => {
  it('creates materials and keeps each user collection isolated', () => {
    const first = createMaterial('material-owner', 'First lesson.mp3');
    const second = createMaterial('material-owner', 'Second lesson.mp3');
    const other = createMaterial('other-material-owner', 'Private lesson.mp3');

    const materials = studyStore.listStudyMaterials('material-owner');

    expect(materials).toHaveLength(2);
    expect(materials.map(({ id }) => id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(materials.map(({ id }) => id)).not.toContain(other.id);
    expect(first).toEqual(
      expect.objectContaining({
        userId: 'material-owner',
        title: 'First lesson.mp3',
        status: 'uploaded',
      }),
    );
    expect(first.id).toEqual(expect.any(String));
    expect(first.createdAt).toEqual(expect.any(String));
    expect(
      studyStore.getStudyMaterial('other-material-owner', first.id),
    ).toBeNull();
  });

  it('stores segments in order and validates timing updates', () => {
    const material = createMaterial('segment-owner', 'Segment lesson.mp3');
    studyStore.saveStudySegments(material.id, [
      { text: 'First sentence.', startSeconds: 0, endSeconds: 1.5 },
      { text: 'Second sentence.', startSeconds: 1.5, endSeconds: 3 },
    ]);

    const stored = studyStore.getStudyMaterial('segment-owner', material.id);
    expect(
      stored?.segments.map(({ index, text }) => ({ index, text })),
    ).toEqual([
      { index: 0, text: 'First sentence.' },
      { index: 1, text: 'Second sentence.' },
    ]);

    const firstSegment = stored?.segments[0];
    expect(firstSegment).toBeDefined();
    if (!firstSegment) return;

    expect(
      studyStore.updateStudySegmentTiming(
        'other-segment-owner',
        material.id,
        firstSegment.id,
        0.2,
        1.4,
      ),
    ).toBe(false);
    expect(
      studyStore.updateStudySegmentTiming(
        'segment-owner',
        material.id,
        firstSegment.id,
        2,
        1,
      ),
    ).toBe(false);
    expect(
      studyStore.updateStudySegmentTiming(
        'segment-owner',
        material.id,
        firstSegment.id,
        0.2,
        1.4,
      ),
    ).toBe(true);
    studyStore.updateStudySegmentAudio(firstSegment.id, '/segments/first.mp3');

    expect(
      studyStore.getStudyMaterial('segment-owner', material.id)?.segments[0],
    ).toEqual(
      expect.objectContaining({
        startSeconds: 0.2,
        endSeconds: 1.4,
        audioPath: '/segments/first.mp3',
        manuallyAdjusted: true,
      }),
    );
  });

  it('updates material processing status and clears stale errors', () => {
    const material = createMaterial('status-owner', 'Status lesson.mp3');

    studyStore.updateStudyMaterialStatus(
      material.id,
      'failed',
      'Transcription failed.',
    );
    expect(
      studyStore.getStudyMaterial('status-owner', material.id)?.material,
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'Transcription failed.',
      }),
    );

    studyStore.updateStudyMaterialStatus(material.id, 'ready');
    expect(
      studyStore.getStudyMaterial('status-owner', material.id)?.material,
    ).toEqual(
      expect.objectContaining({
        status: 'ready',
        error: undefined,
      }),
    );
  });

  it('deduplicates vocabulary per user and enforces ownership on deletion', () => {
    const material = createMaterial('vocabulary-owner', 'Word lesson.mp3');
    studyStore.saveStudySegments(material.id, [
      { text: 'A useful phrase.', startSeconds: 0, endSeconds: 2 },
    ]);
    const segment = studyStore.getStudyMaterial('vocabulary-owner', material.id)
      ?.segments[0];
    expect(segment).toBeDefined();
    if (!segment) return;

    const vocabulary = studyStore.addStudyVocabulary({
      userId: 'vocabulary-owner',
      word: 'useful',
      materialId: material.id,
      segmentId: segment.id,
      sourceText: 'A useful phrase.',
      dictionaryUrl: 'https://example.test/dictionary/useful',
    });
    const duplicate = studyStore.addStudyVocabulary({
      userId: 'vocabulary-owner',
      word: 'useful',
      sourceText: 'A different source.',
      dictionaryUrl: 'https://example.test/dictionary/useful',
    });

    expect(duplicate.id).toBe(vocabulary.id);
    expect(studyStore.listStudyVocabulary('vocabulary-owner')).toEqual([
      vocabulary,
    ]);
    expect(
      studyStore.deleteStudyVocabulary('other-vocabulary-owner', vocabulary.id),
    ).toBe(false);
    expect(
      studyStore.deleteStudyVocabulary('vocabulary-owner', vocabulary.id),
    ).toBe(true);
    expect(studyStore.listStudyVocabulary('vocabulary-owner')).toEqual([]);
  });

  it('deletes a material and its related segments and vocabulary', () => {
    const material = createMaterial('delete-owner', 'Delete lesson.mp3');
    studyStore.saveStudySegments(material.id, [
      { text: 'Delete this sentence.', startSeconds: 0, endSeconds: 2 },
    ]);
    const segment = studyStore.getStudyMaterial('delete-owner', material.id)
      ?.segments[0];
    expect(segment).toBeDefined();
    if (!segment) return;

    studyStore.addStudyVocabulary({
      userId: 'delete-owner',
      word: 'delete',
      materialId: material.id,
      segmentId: segment.id,
      sourceText: 'Delete this sentence.',
      dictionaryUrl: 'https://example.test/dictionary/delete',
    });

    expect(
      studyStore.deleteStudyMaterial('other-delete-owner', material.id),
    ).toBeNull();
    expect(
      studyStore.getStudyMaterial('delete-owner', material.id),
    ).not.toBeNull();
    expect(
      studyStore.deleteStudyMaterial('delete-owner', material.id)?.id,
    ).toBe(material.id);
    expect(studyStore.getStudyMaterial('delete-owner', material.id)).toBeNull();
    expect(studyStore.listStudyVocabulary('delete-owner')).toEqual([]);

    const database = new Database(testDatabasePath, { readonly: true });
    const segmentCount = database
      .prepare(
        'SELECT COUNT(*) AS count FROM study_segments WHERE material_id = ?',
      )
      .get(material.id) as { count: number };
    database.close();
    expect(segmentCount.count).toBe(0);
  });

  it('filters materials by normalized title without leaking other users', () => {
    const angularMaterial = createMaterial(
      'search-owner',
      'Angular Reactive Forms.mp3',
    );
    createMaterial('search-owner', 'English Listening Practice.wav');
    createMaterial('other-search-owner', 'Angular Advanced.mp3');

    const result = studyStore.listStudyMaterials('search-owner', '  ANGULAR  ');
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe(angularMaterial.id);
  });
});
