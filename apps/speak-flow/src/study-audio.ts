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
    const process = spawn('ffmpeg', [
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
    process.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    process.on('error', (cause: Error) => reject(cause));
    process.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `ffmpeg exited with ${code}`)),
    );
  });
}
