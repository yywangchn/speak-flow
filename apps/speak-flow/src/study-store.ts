import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StudyCue, StudySubtitleFormat } from './study-subtitles';

export type StudyMaterial = {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly audioPath: string;
  readonly subtitlePath: string;
  readonly subtitleFormat: StudySubtitleFormat;
  readonly status: 'uploaded' | 'ready' | 'failed';
  readonly error?: string;
  readonly createdAt: string;
};

export type StudySegment = StudyCue & {
  readonly id: string;
  readonly materialId: string;
  readonly index: number;
  readonly audioPath?: string;
  readonly confidence?: number;
  readonly manuallyAdjusted: boolean;
};

const databasePath =
  process.env['SPEAKFLOW_DATABASE_PATH'] ??
  resolve(process.cwd(), 'data/speak-flow.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS study_materials (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
    audio_path TEXT NOT NULL, subtitle_path TEXT NOT NULL, subtitle_format TEXT NOT NULL,
    status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_segments (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL, segment_index INTEGER NOT NULL,
    text TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL,
    audio_path TEXT, confidence REAL, manually_adjusted INTEGER NOT NULL DEFAULT 0
  );
`);

export function createStudyMaterial(
  input: Omit<StudyMaterial, 'id' | 'createdAt' | 'status'>,
): StudyMaterial {
  const material: StudyMaterial = {
    ...input,
    id: randomUUID(),
    status: 'uploaded',
    createdAt: new Date().toISOString(),
  };
  database
    .prepare(
      'INSERT INTO study_materials (id,user_id,title,audio_path,subtitle_path,subtitle_format,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      material.id,
      material.userId,
      material.title,
      material.audioPath,
      material.subtitlePath,
      material.subtitleFormat,
      material.status,
      material.createdAt,
    );
  return material;
}

export function saveStudySegments(
  materialId: string,
  cues: readonly StudyCue[],
): void {
  const insert = database.prepare(
    'INSERT INTO study_segments (id,material_id,segment_index,text,start_seconds,end_seconds,manually_adjusted) VALUES (?,?,?,?,?,?,0)',
  );
  const transaction = database.transaction(() =>
    cues.forEach((cue, index) =>
      insert.run(
        randomUUID(),
        materialId,
        index,
        cue.text,
        cue.startSeconds,
        cue.endSeconds,
      ),
    ),
  );
  transaction();
}

export function updateStudyMaterialStatus(
  id: string,
  status: StudyMaterial['status'],
  error?: string,
): void {
  database
    .prepare('UPDATE study_materials SET status = ?, error = ? WHERE id = ?')
    .run(status, error ?? null, id);
}

export function updateStudySegmentAudio(id: string, audioPath: string): void {
  database
    .prepare('UPDATE study_segments SET audio_path = ? WHERE id = ?')
    .run(audioPath, id);
}

export function listStudyMaterials(userId: string): StudyMaterial[] {
  return database
    .prepare(
      'SELECT * FROM study_materials WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(userId)
    .map((row) => toMaterial(row as Record<string, unknown>));
}

export function getStudyMaterial(
  userId: string,
  id: string,
): { material: StudyMaterial; segments: StudySegment[] } | null {
  const row = database
    .prepare('SELECT * FROM study_materials WHERE user_id = ? AND id = ?')
    .get(userId, id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const segments = database
    .prepare(
      'SELECT * FROM study_segments WHERE material_id = ? ORDER BY segment_index',
    )
    .all(id)
    .map((value) => toSegment(value as Record<string, unknown>));
  return { material: toMaterial(row), segments };
}

function toMaterial(row: Record<string, unknown>): StudyMaterial {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    title: String(row['title']),
    audioPath: String(row['audio_path']),
    subtitlePath: String(row['subtitle_path']),
    subtitleFormat: row['subtitle_format'] as StudySubtitleFormat,
    status: row['status'] as StudyMaterial['status'],
    error: typeof row['error'] === 'string' ? row['error'] : undefined,
    createdAt: String(row['created_at']),
  };
}
function toSegment(row: Record<string, unknown>): StudySegment {
  return {
    id: String(row['id']),
    materialId: String(row['material_id']),
    index: Number(row['segment_index']),
    text: String(row['text']),
    startSeconds: Number(row['start_seconds']),
    endSeconds: Number(row['end_seconds']),
    audioPath:
      typeof row['audio_path'] === 'string' ? row['audio_path'] : undefined,
    confidence:
      typeof row['confidence'] === 'number' ? row['confidence'] : undefined,
    manuallyAdjusted: Boolean(row['manually_adjusted']),
  };
}
