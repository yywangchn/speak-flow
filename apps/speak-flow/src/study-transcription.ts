import { spawn } from 'node:child_process';

export function transcribeWithLocalWhisper(
  audioPath: string,
  outputSrtPath: string,
): Promise<void> {
  const modelPath = process.env['SPEAKFLOW_WHISPER_MODEL'];
  if (!modelPath)
    return Promise.reject(
      new Error(
        'Local Whisper is not configured. Set SPEAKFLOW_WHISPER_MODEL to a ggml model path.',
      ),
    );
  return new Promise((resolve, reject) => {
    const process = spawn(
      process.env['SPEAKFLOW_WHISPER_COMMAND'] ?? 'whisper-cli',
      [
        '-m',
        modelPath,
        '-f',
        audioPath,
        '--output-srt',
        '--output-file',
        outputSrtPath.replace(/\.srt$/i, ''),
      ],
    );
    let error = '';
    process.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `Whisper exited with ${code}`)),
    );
  });
}
