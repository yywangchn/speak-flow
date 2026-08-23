import { spawn } from 'node:child_process';

export function cutAudioSegment(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number,
): Promise<void> {
  const duration = endSeconds - startSeconds;
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    return Promise.reject(
      new Error('A valid audio segment range is required.'),
    );
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-ss',
      String(startSeconds),
      '-i',
      inputPath,
      '-t',
      String(duration),
      '-vn',
      '-acodec',
      'libmp3lame',
      outputPath,
    ]);
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on('error', (cause: Error) => reject(cause));
    child.on('close', (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `ffmpeg exited with ${code}`)),
    );
  });
}

export function extractAudio(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      outputPath,
    ]);
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `ffmpeg exited with ${code}`)),
    );
  });
}
